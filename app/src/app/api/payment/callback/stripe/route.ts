/**
 * Stripe Webhook 回调 API
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { stripe as stripeService } from "@/services/payment";
import { fulfillPaidOrder } from "@/lib/orders";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:payment:callback:stripe");

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature") || "";

    // 验证 Webhook 签名（验签逻辑保持不变）
    const result = stripeService.verifyWebhook(body, signature);

    if (!result.valid) {
      log.error("Stripe Webhook 验证失败:", result.error);
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // 查找订单
    const order = await prisma.order.findUnique({
      where: { orderNo: result.orderId },
    });

    if (!order) {
      log.error("订单不存在:", result.orderId);
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // R7：金额校验改为转分（整数）比较，避免浮点误差
    if (
      Math.round((result.paidAmount || 0) * 100) !==
      Math.round(order.amount.toNumber() * 100)
    ) {
      log.error("支付金额不匹配:", result.paidAmount, order.amount);
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    // R3/R4：幂等抢占 + 发放积分 + 建订阅，逻辑收口在 lib/orders.ts。
    // 发放事务失败时该函数会自行把订单回退成 PENDING 并上抛，落到 catch 返回
    // 500 让 Stripe 重试；already_paid 分支返回 received 让 Stripe 停止重试。
    const outcome = await fulfillPaidOrder({
      orderNo: order.orderNo,
      paymentMethod: "STRIPE",
      paymentId: result.transactionId,
      actor: { type: "callback" },
    });

    if (outcome.status === "invalid_state") {
      log.error("订单状态非待支付，拒绝履约:", order.orderNo, order.status);
      return NextResponse.json(
        { error: "Invalid order state" },
        { status: 400 }
      );
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    log.error("Stripe Webhook 处理错误:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
