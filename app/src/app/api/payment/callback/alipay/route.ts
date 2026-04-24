/**
 * 支付宝回调 API
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { alipay } from "@/services/payment";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:payment:callback:alipay");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};

    formData.forEach((value, key) => {
      if (typeof value === "string") {
        params[key] = value;
      }
    });

    // 验证回调签名
    const result = alipay.verifyCallback(params);

    if (!result.valid) {
      log.error("支付宝回调验证失败:", result.error);
      return new NextResponse("fail", { status: 400 });
    }

    // 查找订单
    const order = await prisma.order.findUnique({
      where: { orderNo: result.orderId },
    });

    if (!order) {
      log.error("订单不存在:", result.orderId);
      return new NextResponse("fail", { status: 404 });
    }

    // 检查订单状态，防止重复处理
    if (order.status === "PAID") {
      return new NextResponse("success", { status: 200 });
    }

    // 验证金额
    if (Math.abs((result.paidAmount || 0) - order.amount) > 0.01) {
      log.error("支付金额不匹配:", result.paidAmount, order.amount);
      return new NextResponse("fail", { status: 400 });
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

    // 支付宝要求返回 "success" 字符串
    return new NextResponse("success", { status: 200 });
  } catch (error) {
    log.error("支付宝回调处理错误:", error);
    return new NextResponse("fail", { status: 500 });
  }
}
