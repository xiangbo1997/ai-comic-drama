/**
 * 后台订单详情
 *
 * GET /api/admin/orders/[id]
 *   → { order, user, creditTransactions, auditLogs }
 *
 * 三块关联数据的用途：
 * - creditTransactions：按 `sourceId = order.id` 反查发放/扣回流水，用来回答
 *   「这单的积分到底发没发、退没退」。注意 sourceId 存的是 order.id 而非
 *   orderNo（见 lib/orders.ts 的注释），这里必须对齐，否则永远查不到。
 * - auditLogs：该订单上所有管理员动作（标记已支付、退款）。
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";
import { serializeAmount } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:orders:detail");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  try {
    const { id } = await params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            credits: true,
            role: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    }

    const [creditTransactions, auditLogs] = await Promise.all([
      prisma.creditTransaction.findMany({
        where: { sourceId: order.id },
        orderBy: { createdAt: "desc" },
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
      prisma.adminAuditLog.findMany({
        where: { targetType: "order", targetId: order.id },
        orderBy: { createdAt: "desc" },
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

    const { user, amount, ...rest } = order;

    return NextResponse.json({
      order: { ...rest, amount: serializeAmount(amount) },
      user,
      creditTransactions,
      auditLogs,
    });
  } catch (err) {
    log.error("查询订单详情失败", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "查询订单详情失败" }, { status: 500 });
  }
}
