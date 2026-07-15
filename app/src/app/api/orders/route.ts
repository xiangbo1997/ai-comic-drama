/**
 * 用户订单列表 API
 *
 * 提供当前用户最近若干笔订单供 credits 页「最近订单」卡片展示。
 * 只返回本人订单，字段脱敏（不含 paymentId 支付流水号、subscriptionId 等内部标识）。
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:orders");

/** 最近订单返回上限 */
const RECENT_ORDERS_LIMIT = 10;

// GET /api/orders - 获取当前用户最近订单（近 10 笔，按创建时间倒序）
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orders = await prisma.order.findMany({
      where: { userId: session.user.id }, // 本人过滤
      orderBy: { createdAt: "desc" },
      take: RECENT_ORDERS_LIMIT,
      // 字段脱敏：仅暴露展示所需字段，剔除 paymentId/subscriptionId 等内部标识
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
    });

    // Decimal（amount）序列化为字符串，避免 JSON 精度问题；前端按数值格式化展示
    const safeOrders = orders.map((order) => ({
      ...order,
      amount: order.amount.toString(),
    }));

    return NextResponse.json({ orders: safeOrders });
  } catch (error) {
    log.error("Get orders error:", error);
    return NextResponse.json({ error: "获取订单列表失败" }, { status: 500 });
  }
}
