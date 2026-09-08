/**
 * 用户列表 API
 *
 * GET /api/admin/users?cursor&limit&q&role&status&sort —— 游标分页列出用户
 *
 * 只读端点，不落审计日志（见 lib/admin-audit.ts 的约定：读操作不记，否则
 * 翻页噪音会淹没真正需要追责的写动作）。
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { parseUserSort } from "@/lib/admin-users";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  parseCursor,
  sliceCursorPage,
} from "@/types/pagination";

const log = createLogger("api:admin:users");

/** 角色 / 状态筛选值（"all" 表示不筛） */
const roleFilterSchema = z.enum(["all", "USER", "ADMIN", "SUPER_ADMIN"]);
const statusFilterSchema = z.enum(["all", "ACTIVE", "BANNED"]);

/**
 * 搜索关键词上限：搜索走 `contains` 全表扫描（email/name 无 trigram 索引），
 * 超长串既无意义又平白拉长查询，直接截断。
 */
const MAX_QUERY_LENGTH = 100;

/**
 * 解析并夹紧 limit。
 *
 * 不复用 `parsePageLimit`：那个函数为兼容老端点的「不传 limit 返回裸数组」
 * 语义而返回 null，后台列表没有这个包袱——始终分页，未传就用默认值。
 */
function parseLimit(raw: string | null): number {
  const parsed = Number(raw?.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  const params = request.nextUrl.searchParams;
  const limit = parseLimit(params.get("limit"));
  const cursor = parseCursor(params.get("cursor"));
  const sort = parseUserSort(params.get("sort"));
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);

  const roleParsed = roleFilterSchema.safeParse(params.get("role") ?? "all");
  const statusParsed = statusFilterSchema.safeParse(
    params.get("status") ?? "all"
  );
  if (!roleParsed.success || !statusParsed.success) {
    return NextResponse.json(
      { error: "role / status 筛选值非法" },
      { status: 400 }
    );
  }
  const role = roleParsed.data;
  const status = statusParsed.data;

  const where: Prisma.UserWhereInput = {
    ...(role === "all" ? {} : { role }),
    ...(status === "all" ? {} : { status }),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            // id 是 cuid，大小写敏感且用户通常整段粘贴，用 equals 更贴合意图；
            // 但保留 contains 以支持只记得片段的场景
            { id: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // 次级排序键固定为 id：createdAt / lastLoginAt 可能重复（尤其 lastLoginAt
  // 大量为 null），只按主键排序时游标分页会漏行或重复行。
  const orderBy: Prisma.UserOrderByWithRelationInput[] = [
    { [sort]: "desc" } as Prisma.UserOrderByWithRelationInput,
    { id: "desc" },
  ];

  try {
    const rows = await prisma.user.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        credits: true,
        createdAt: true,
        lastLoginAt: true,
        inviteCode: true,
        _count: { select: { projects: true } },
      },
    });

    const page = sliceCursorPage(rows, limit);

    return NextResponse.json({
      items: page.items.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        credits: u.credits,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        inviteCode: u.inviteCode,
        projectCount: u._count.projects,
      })),
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    log.error("查询用户列表失败:", error);
    return NextResponse.json({ error: "查询用户列表失败" }, { status: 500 });
  }
}
