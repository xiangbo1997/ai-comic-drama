/**
 * 后台积分流水列表
 *
 * GET /api/admin/credit-transactions?cursor&limit&q&type&from&to&userId
 *   → { items, nextCursor, summary: { granted, charged } }
 *
 * summary 是当前筛选条件下的全量口径（不受分页影响）：
 * - granted：所有正向变动之和（发放/退款）
 * - charged：所有负向变动的绝对值之和（扣费）
 * 两者分开算而不是给一个净额——运营要看的是「发出去多少 / 消耗多少」，
 * 净额会把两条完全不同的业务曲线抹平成一个没信息量的数字。
 */

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PAGE_SIZE,
  parseCursor,
  parsePageLimit,
  sliceCursorPage,
} from "@/types/pagination";

const log = createLogger("api:admin:credit-transactions");

/**
 * 允许筛选的流水类型白名单。
 *
 * 与 lib/credits.ts 的 ChargeType ∪ GrantType ∪ REFUND 对齐。用白名单而非
 * 自由字符串：type 字段在 schema 里是 String 不是 enum，直接把用户输入拼进
 * where 会让筛选器变成一个可以探测任意值的接口。
 */
const TRANSACTION_TYPES = [
  "GENERATE_IMAGE",
  "GENERATE_VIDEO",
  "GENERATE_TTS",
  "GENERATE_REFERENCE",
  "GENERATE_SCRIPT",
  "ADMIN_DEDUCT",
  "PAYMENT",
  "SUBSCRIPTION",
  "CHECKIN",
  "INVITE",
  "ADMIN_GRANT",
  "REFUND",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** 解析日期边界；非法日期视为未传 */
function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildWhere(
  searchParams: URLSearchParams
): Prisma.CreditTransactionWhereInput {
  const q = searchParams.get("q")?.trim();
  const rawType = searchParams.get("type");
  const userId = searchParams.get("userId")?.trim();
  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));

  const where: Prisma.CreditTransactionWhereInput = {};

  if (rawType && TRANSACTION_TYPES.includes(rawType as TransactionType)) {
    where.type = rawType;
  }

  if (userId) where.userId = userId;

  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  if (q) {
    where.OR = [
      { sourceId: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
      { user: { email: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  try {
    const { searchParams } = new URL(request.url);
    const where = buildWhere(searchParams);
    const limit =
      parsePageLimit(searchParams.get("limit")) ?? DEFAULT_PAGE_SIZE;
    const cursor = parseCursor(searchParams.get("cursor"));

    const [rows, grantedAgg, chargedAgg] = await Promise.all([
      prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          userId: true,
          delta: true,
          balanceAfter: true,
          type: true,
          source: true,
          sourceId: true,
          note: true,
          createdAt: true,
          user: { select: { email: true } },
        },
      }),
      prisma.creditTransaction.aggregate({
        where: { ...where, delta: { gt: 0 } },
        _sum: { delta: true },
      }),
      prisma.creditTransaction.aggregate({
        where: { ...where, delta: { lt: 0 } },
        _sum: { delta: true },
      }),
    ]);

    const page = sliceCursorPage(rows, limit);

    return NextResponse.json({
      items: page.items.map((row) => ({
        id: row.id,
        userId: row.userId,
        userEmail: row.user.email,
        delta: row.delta,
        balanceAfter: row.balanceAfter,
        type: row.type,
        source: row.source,
        sourceId: row.sourceId,
        note: row.note,
        createdAt: row.createdAt,
      })),
      nextCursor: page.nextCursor,
      summary: {
        granted: grantedAgg._sum.delta ?? 0,
        // 负向和取绝对值，前端直接展示「消耗 N 积分」
        charged: Math.abs(chargedAgg._sum.delta ?? 0),
      },
    });
  } catch (err) {
    log.error("查询积分流水失败", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "查询积分流水失败" }, { status: 500 });
  }
}
