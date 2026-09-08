/**
 * 审计日志查询
 *
 * GET /api/admin/audit-logs?cursor&limit&actorId&targetType&targetId&action&from&to
 *
 * 用**游标分页**而非 offset：日志表只增不减且按时间倒序看，offset 翻到第
 * 几百页时 `OFFSET 10000` 要扫掉前一万行；游标（上一页末条 id）配合
 * `@@index([createdAt])` 每页代价恒定。代价是不能跳页，但审计日志本来就是
 * 「从最近往回翻 + 按条件筛」的用法，跳页没有意义。
 *
 * 排序键用 `createdAt desc, id desc`：单看 createdAt 在同毫秒写入的多条记录
 * 上不稳定，翻页会重复或漏行；补上 id 作为决胜键才是全序。
 *
 * 只读端点，故**不写审计日志**——记录「谁查了日志」会让表被翻页噪音淹没，
 * 真正要追责的写操作反而被埋掉（见 lib/admin-audit.ts 文件头约定）。
 */

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:audit-logs");

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** 解析 limit：非法值回落默认，超上限截断（避免一次拉爆内存） */
function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/** 解析日期参数；非法日期视为未传（而非报错——筛选器是辅助，不该卡住查询） */
function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  const params = request.nextUrl.searchParams;
  const limit = parseLimit(params.get("limit"));
  const cursor = params.get("cursor");
  const actorId = params.get("actorId")?.trim() || undefined;
  const targetType = params.get("targetType")?.trim() || undefined;
  const targetId = params.get("targetId")?.trim() || undefined;
  const action = params.get("action")?.trim() || undefined;
  const from = parseDate(params.get("from"));
  const to = parseDate(params.get("to"));

  const where: Prisma.AdminAuditLogWhereInput = {
    ...(actorId ? { actorId } : {}),
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
    // action 用前缀匹配：`user.` 能一次筛出该对象的全部动作，比要求管理员
    // 背下完整 action 名实用得多
    ...(action ? { action: { startsWith: action } } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  try {
    // 多取一条用于判断还有没有下一页，返回前丢弃
    const rows = await prisma.adminAuditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        before: true,
        after: true,
        note: true,
        ip: true,
        createdAt: true,
        actorId: true,
        actor: { select: { email: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        before: row.before,
        after: row.after,
        note: row.note,
        ip: row.ip,
        createdAt: row.createdAt,
        actorId: row.actorId,
        // 操作者可能已被删除（onDelete: Cascade 会连日志一起删，故正常不会
        // 出现；保留兜底以防历史数据）
        actorEmail: row.actor?.email ?? null,
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    });
  } catch (error) {
    log.error("查询审计日志失败:", error);
    return NextResponse.json({ error: "查询审计日志失败" }, { status: 500 });
  }
}
