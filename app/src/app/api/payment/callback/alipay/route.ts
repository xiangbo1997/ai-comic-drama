/**
 * 支付宝回调 API
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { alipay } from "@/services/payment";
import { fulfillPaidOrder } from "@/lib/orders";

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

    // 验证回调签名（验签逻辑保持不变）
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

    // R7：金额校验改为转分（整数）比较，避免浮点误差
    if (
      Math.round((result.paidAmount || 0) * 100) !==
      Math.round(order.amount.toNumber() * 100)
    ) {
      log.error("支付金额不匹配:", result.paidAmount, order.amount);
      return new NextResponse("fail", { status: 400 });
    }

    // R3/R4：幂等抢占 + 发放积分 + 建订阅，逻辑收口在 lib/orders.ts。
    // 发放事务失败时该函数会自行把订单回退成 PENDING 并上抛，落到 catch 返回
    // fail/500 让支付宝重试；already_paid 分支返回 success 让网关停止重试。
    const outcome = await fulfillPaidOrder({
      orderNo: order.orderNo,
      paymentMethod: "ALIPAY",
      paymentId: result.transactionId,
      actor: { type: "callback" },
    });

    if (outcome.status === "invalid_state") {
      log.error("订单状态非待支付，拒绝履约:", order.orderNo, order.status);
      return new NextResponse("fail", { status: 400 });
    }

    // 支付宝要求返回 "success" 字符串
    return new NextResponse("success", { status: 200 });
  } catch (error) {
    log.error("支付宝回调处理错误:", error);
    return new NextResponse("fail", { status: 500 });
  }
}
