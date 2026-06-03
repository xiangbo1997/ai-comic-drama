/**
 * Stripe Webhook 回调 API
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { stripe as stripeService } from "@/services/payment";
import { grantCredits } from "@/lib/credits";

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

    // R3：幂等闸门 —— 条件原子更新，只有 PENDING → PAID 抢占成功的一次才发放积分
    // Stripe 重试时，第二次起 claimed.count === 0，直接幂等返回 received
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: {
        status: "PAID",
        paymentId: result.transactionId,
        paidAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      // 已被其他回调处理过，幂等返回成功，让 Stripe 停止重试
      log.info(`订单已处理过，幂等返回: ${order.orderNo}`);
      return NextResponse.json({ received: true });
    }

    // R4：抢占成功后，发放积分 + 创建订阅包进同一事务，保证原子性
    try {
      await prisma.$transaction(async (tx) => {
        // 发放积分 + 记流水
        await grantCredits(tx, {
          userId: order.userId,
          amount: order.credits,
          type: order.type === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PAYMENT",
          source: "stripe",
          sourceId: order.id,
          note: `订单 ${order.orderNo} 支付到账`,
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

          await tx.subscription.create({
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

          await tx.order.update({
            where: { id: order.id },
            data: { expiresAt: periodEnd },
          });
        }
      });
    } catch (txError) {
      // 事务失败：积分/订阅未落库，但订单已被标记 PAID。
      // 回退订单状态为 PENDING 以便 Stripe 重试时重新发放，并返回 500。
      log.error("Stripe 积分发放事务失败，回退订单状态:", txError);
      try {
        await prisma.order.updateMany({
          where: { id: order.id, status: "PAID" },
          data: { status: "PENDING", paymentId: null, paidAt: null },
        });
      } catch (rollbackError) {
        log.error("回退订单状态失败，需人工介入:", rollbackError);
      }
      return NextResponse.json(
        { error: "Webhook processing failed" },
        { status: 500 }
      );
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
