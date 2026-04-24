/**
 * Stripe Webhook 回调 API
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { stripe as stripeService } from "@/services/payment";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:payment:callback:stripe");

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature") || "";

    // 验证 Webhook 签名
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

    // 检查订单状态，防止重复处理
    if (order.status === "PAID") {
      return NextResponse.json({ received: true });
    }

    // 验证金额
    if (Math.abs((result.paidAmount || 0) - order.amount) > 0.01) {
      log.error("支付金额不匹配:", result.paidAmount, order.amount);
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    // 更新订单状态
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paymentId: result.transactionId,
        paidAt: new Date(),
      },
    });

    // 发放积分
    await prisma.user.update({
      where: { id: order.userId },
      data: {
        credits: { increment: order.credits },
      },
    });

    // 如果是订阅，创建订阅记录
    if (order.type === "SUBSCRIPTION") {
      const now = new Date();
      const periodEnd = new Date(now);

      if (order.productId === "monthly") {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      } else if (order.productId === "yearly") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      }

      await prisma.subscription.create({
        data: {
          userId: order.userId,
          planId: order.productId,
          planName: order.productName,
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          creditsPerPeriod: order.credits,
          lastCreditAt: now,
        },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { expiresAt: periodEnd },
      });
    }

    log.info(`订单支付成功: ${order.orderNo}, 发放 ${order.credits} 积分`);

    return NextResponse.json({ received: true });
  } catch (error) {
    log.error("Stripe Webhook 处理错误:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
