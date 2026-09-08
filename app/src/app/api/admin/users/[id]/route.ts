/**
 * 用户详情 / 编辑 API
 *
 * GET   /api/admin/users/[id] —— 详情 + 统计 + 近期流水 / 订单 / 审计
 * PATCH /api/admin/users/[id] —— 改昵称（管理员）、改角色 / 封禁解封（超管）
 *
 * 权限判定统一走 lib/admin-users.ts 的 canActOn，服务端是唯一防线；前端同样
 * 调用它只是为了少渲染点不该点的按钮。
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma, UserRole, UserStatus } from "@prisma/client";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { requestIp, writeAuditLog } from "@/lib/admin-audit";
import { canActOn } from "@/lib/admin-users";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:users:detail");

/** 近期记录的展示条数：够看清最近动向，又不至于把详情接口拖成大查询 */
const RECENT_TRANSACTIONS = 20;
const RECENT_ORDERS = 10;
const RECENT_AUDIT_LOGS = 20;

/** 消费统计窗口（天） */
const SPEND_WINDOW_DAYS = 30;

const patchSchema = z
  .object({
    name: z.string().trim().max(50, "昵称最长 50 字").nullable().optional(),
    role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]).optional(),
    status: z.enum(["ACTIVE", "BANNED"]).optional(),
    banReason: z.string().trim().max(200, "封禁原因最长 200 字").optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined || v.role !== undefined || v.status !== undefined,
    { message: "没有需要修改的字段" }
  );

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  const { id } = await params;

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        status: true,
        credits: true,
        bannedAt: true,
        banReason: true,
        lastLoginAt: true,
        inviteCode: true,
        invitedBy: true,
        createdAt: true,
        _count: { select: { projects: true, characters: true, series: true } },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    const since = new Date(Date.now() - SPEND_WINDOW_DAYS * 86_400_000);

    const [paidAgg, spendAgg, recentTransactions, recentOrders, recentLogs] =
      await Promise.all([
        prisma.order.aggregate({
          where: { userId: id, status: "PAID" },
          _count: true,
          _sum: { amount: true },
        }),
        // 近 30 天消费：只统计负向流水（生成扣费与管理员扣减），取绝对值
        prisma.creditTransaction.aggregate({
          where: { userId: id, delta: { lt: 0 }, createdAt: { gte: since } },
          _sum: { delta: true },
        }),
        prisma.creditTransaction.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          take: RECENT_TRANSACTIONS,
          select: {
            id: true,
            delta: true,
            balanceAfter: true,
            type: true,
            source: true,
            note: true,
            createdAt: true,
          },
        }),
        prisma.order.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          take: RECENT_ORDERS,
          select: {
            id: true,
            orderNo: true,
            type: true,
            productName: true,
            amount: true,
            credits: true,
            status: true,
            paymentMethod: true,
            paidAt: true,
            createdAt: true,
          },
        }),
        // 以该用户为「操作对象」的审计记录（不是他自己作为操作者的）
        prisma.adminAuditLog.findMany({
          where: { targetType: "user", targetId: id },
          orderBy: { createdAt: "desc" },
          take: RECENT_AUDIT_LOGS,
          select: {
            id: true,
            action: true,
            before: true,
            after: true,
            note: true,
            ip: true,
            createdAt: true,
            actor: { select: { id: true, email: true } },
          },
        }),
      ]);

    const { _count, ...profile } = user;

    return NextResponse.json({
      user: profile,
      stats: {
        projects: _count.projects,
        characters: _count.characters,
        series: _count.series,
        ordersPaid: paidAgg._count,
        // Decimal 不能直接 JSON 序列化成数字，转字符串再解析，保留两位小数语义
        totalPaidAmount: Number(paidAgg._sum.amount ?? 0),
        creditsSpent30d: Math.abs(spendAgg._sum.delta ?? 0),
      },
      recentTransactions,
      recentOrders: recentOrders.map((o) => ({
        ...o,
        amount: Number(o.amount),
      })),
      recentAuditLogs: recentLogs.map((l) => ({
        id: l.id,
        action: l.action,
        before: l.before,
        after: l.after,
        note: l.note,
        ip: l.ip,
        createdAt: l.createdAt,
        actorEmail: l.actor.email,
      })),
    });
  } catch (error) {
    log.error("查询用户详情失败:", error);
    return NextResponse.json({ error: "查询用户详情失败" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  const { admin } = gate;

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "请求参数非法" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      status: true,
      banReason: true,
      bannedAt: true,
    },
  });
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  // 逐字段过闸：一次请求可能同时改昵称与角色，任一被拒则整体拒绝，
  // 避免出现「昵称改了但角色没改」的半成功状态。
  const requestedActions: Array<"update" | "role" | "ban"> = [];
  if (body.name !== undefined) requestedActions.push("update");
  if (body.role !== undefined && body.role !== target.role)
    requestedActions.push("role");
  if (body.status !== undefined && body.status !== target.status)
    requestedActions.push("ban");

  for (const action of requestedActions) {
    const verdict = canActOn(admin, target, action);
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.reason }, { status: 403 });
    }
  }

  const data: Prisma.UserUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const nextName = body.name === null || body.name === "" ? null : body.name;
    data.name = nextName;
    before.name = target.name;
    after.name = nextName;
  }

  if (body.role !== undefined && body.role !== target.role) {
    data.role = body.role as UserRole;
    before.role = target.role;
    after.role = body.role;
  }

  let banAction: "ban" | "unban" | null = null;
  if (body.status !== undefined && body.status !== target.status) {
    const nextStatus = body.status as UserStatus;
    data.status = nextStatus;
    before.status = target.status;
    after.status = nextStatus;

    if (nextStatus === "BANNED") {
      banAction = "ban";
      data.bannedAt = new Date();
      data.banReason = body.banReason ?? null;
      before.banReason = target.banReason;
      after.banReason = body.banReason ?? null;
    } else {
      // 解封必须同时清掉封禁时间与原因，否则详情页会显示「已解封但仍有封禁理由」
      banAction = "unban";
      data.bannedAt = null;
      data.banReason = null;
      before.banReason = target.banReason;
      after.banReason = null;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有需要修改的字段" }, { status: 400 });
  }

  const ip = requestIp(request);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          credits: true,
          bannedAt: true,
          banReason: true,
        },
      });

      // 一次请求可能触发多个语义动作，各记一条：改角色与封禁的追责场景不同，
      // 合成一条 user.update 会让「谁封的号」这类检索失效。
      if (after.role !== undefined) {
        await writeAuditLog(tx, {
          actorId: admin.id,
          action: "user.role.update",
          targetType: "user",
          targetId: id,
          before: { role: before.role as string },
          after: { role: after.role as string },
          ip,
        });
      }

      if (banAction) {
        await writeAuditLog(tx, {
          actorId: admin.id,
          action: banAction === "ban" ? "user.ban" : "user.unban",
          targetType: "user",
          targetId: id,
          before: {
            status: before.status as string,
            banReason: (before.banReason as string | null) ?? null,
          },
          after: {
            status: after.status as string,
            banReason: (after.banReason as string | null) ?? null,
          },
          note: banAction === "ban" ? (body.banReason ?? undefined) : undefined,
          ip,
        });
      }

      if (after.name !== undefined) {
        await writeAuditLog(tx, {
          actorId: admin.id,
          action: "user.update",
          targetType: "user",
          targetId: id,
          before: { name: (before.name as string | null) ?? null },
          after: { name: (after.name as string | null) ?? null },
          ip,
        });
      }

      return next;
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    log.error("修改用户失败:", error);
    return NextResponse.json({ error: "修改用户失败" }, { status: 500 });
  }
}
