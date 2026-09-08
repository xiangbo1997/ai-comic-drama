/**
 * 后台订单列表
 *
 * GET /api/admin/orders?cursor&limit&q&status&type&method&from&to
 *   → { items, nextCursor, summary: { count, paidAmount } }
 *
 * summary 统计的是**当前筛选条件下的全量**（不受游标分页影响），用 aggregate
 * 单独算一次：运营看的是「这批筛选出来的订单一共多少钱」，不是「这一页多少钱」。
 * paidAmount 只累计 status=PAID 的金额——未支付/已退款的订单不构成收入。
 */

import { Prisma } from "@prisma/client";
import type { OrderStatus, OrderType, PaymentMethod } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";
import { serializeAmount } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PAGE_SIZE,
  parseCursor,
  parsePageLimit,
  sliceCursorPage,
} from "@/types/pagination";

const log = createLogger("api:admin:orders");

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "PAID",
  "CANCELLED",
  "REFUNDED",
  "EXPIRED",
];
const ORDER_TYPES: OrderType[] = ["CREDITS", "SUBSCRIPTION"];
const PAYMENT_METHODS: PaymentMethod[] = ["WECHAT", "ALIPAY", "STRIPE"];

/** 把查询参数收窄成枚举值；非法或缺省返回 undefined（= 不过滤） */
function parseEnum<T extends string>(
  raw: string | null,
  allowed: readonly T[]
): T | undefined {
  if (!raw) return undefined;
  return allowed.includes(raw as T) ? (raw as T) : undefined;
}

/** 解析日期边界；非法日期返回 undefined 而不是 Invalid Date（会让 Prisma 报错） */
function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** 组装筛选条件；列表与 summary 共用同一份，避免两处口径漂移 */
function buildWhere(searchParams: URLSearchParams): Prisma.OrderWhereInput {
  const q = searchParams.get("q")?.trim();
  const status = parseEnum(searchParams.get("status"), ORDER_STATUSES);
  const type = parseEnum(searchParams.get("type"), ORDER_TYPES);
  const method = parseEnum(searchParams.get("method"), PAYMENT_METHODS);
  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));

  const where: Prisma.OrderWhereInput = {};

  if (status) where.status = status;
  if (type) where.type = type;
  if (method) where.paymentMethod = method;

  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  if (q) {
    // 订单号 / 用户邮箱 / 渠道流水号三选一命中
    where.OR = [
      { orderNo: { contains: q, mode: "insensitive" } },
      { paymentId: { contains: q, mode: "insensitive" } },
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

    const [rows, countAll, paidAgg] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        // 多取一条用于探测下一页；游标本身不计入结果
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          orderNo: true,
          userId: true,
          type: true,
          productId: true,
          productName: true,
          amount: true,
          credits: true,
          status: true,
          paymentMethod: true,
          paymentId: true,
          paidAt: true,
          createdAt: true,
          user: { select: { email: true } },
        },
      }),
      prisma.order.count({ where }),
      // 收入口径：只算已支付
      prisma.order.aggregate({
        where: { ...where, status: "PAID" },
        _sum: { amount: true },
      }),
    ]);

    const page = sliceCursorPage(rows, limit);

    return NextResponse.json({
      items: page.items.map((row) => ({
        id: row.id,
        orderNo: row.orderNo,
        userId: row.userId,
        userEmail: row.user.email,
        type: row.type,
        productId: row.productId,
        productName: row.productName,
        // Decimal 直接 JSON 序列化会变成对象，统一转两位小数字符串
        amount: serializeAmount(row.amount),
        credits: row.credits,
        status: row.status,
        paymentMethod: row.paymentMethod,
        paymentId: row.paymentId,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
      })),
      nextCursor: page.nextCursor,
      summary: {
        count: countAll,
        paidAmount: serializeAmount(
          paidAgg._sum.amount ?? new Prisma.Decimal(0)
        ),
      },
    });
  } catch (err) {
    log.error("查询订单列表失败", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "查询订单列表失败" }, { status: 500 });
  }
}
