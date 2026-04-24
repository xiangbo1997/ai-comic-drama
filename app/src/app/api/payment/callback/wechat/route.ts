/**
 * 微信支付回调 API
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { wechatPay } from "@/services/payment";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:payment:callback:wechat");

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const headers: Record<string, string> = {};

    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // 验证回调签名
    const result = wechatPay.verifyCallback(headers, body);

    if (!result.valid) {
      log.error("微信支付回调验证失败:", result.error);
      return new NextResponse(
        JSON.stringify({ code: "FAIL", message: result.error }),
        { status: 400 }
      );
    }

    // 查找订单
    const order = await prisma.order.findUnique({
      where: { orderNo: result.orderId },
    });

    if (!order) {
      log.error("订单不存在:", result.orderId);
      return new NextResponse(
        JSON.stringify({ code: "FAIL", message: "订单不存在" }),
        { status: 404 }
      );
    }

    // 检查订单状态，防止重复处理
    if (order.status === "PAID") {
      return new NextResponse(
        JSON.stringify({ code: "SUCCESS", message: "OK" }),
        { status: 200 }
      );
    }

    // 验证金额
    if (Math.abs((result.paidAmount || 0) - order.amount) > 0.01) {
      log.error("支付金额不匹配:", result.paidAmount, order.amount);
      return new NextResponse(
        JSON.stringify({ code: "FAIL", message: "金额不匹配" }),
        { status: 400 }
      );
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

      // 根据订阅周期设置结束时间
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

      // 更新订单的订阅到期时间
      await prisma.order.update({
        where: { id: order.id },
        data: { expiresAt: periodEnd },
      });
    }

    log.info(`订单支付成功: ${order.orderNo}, 发放 ${order.credits} 积分`);

    return new NextResponse(
      JSON.stringify({ code: "SUCCESS", message: "OK" }),
      { status: 200 }
    );
  } catch (error) {
    log.error("微信支付回调处理错误:", error);
    return new NextResponse(
      JSON.stringify({ code: "FAIL", message: "处理失败" }),
      { status: 500 }
    );
  }
}
