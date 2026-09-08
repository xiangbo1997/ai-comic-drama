/**
 * 微信支付回调 API
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { wechatPay } from "@/services/payment";
import { fulfillPaidOrder } from "@/lib/orders";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:payment:callback:wechat");

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const headers: Record<string, string> = {};

    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // 验证回调签名（验签逻辑保持不变）
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

    // R7：金额校验改为转分（整数）比较，避免浮点误差
    if (
      Math.round((result.paidAmount || 0) * 100) !==
      Math.round(order.amount.toNumber() * 100)
    ) {
      log.error("支付金额不匹配:", result.paidAmount, order.amount);
      return new NextResponse(
        JSON.stringify({ code: "FAIL", message: "金额不匹配" }),
        { status: 400 }
      );
    }

    // R3/R4：幂等抢占 + 发放积分 + 建订阅，逻辑收口在 lib/orders.ts。
    // 发放事务失败时该函数会自行把订单回退成 PENDING 并上抛，落到 catch 返回 500，
    // 让网关重试；already_paid 分支同样返回 SUCCESS 让网关停止重试。
    const outcome = await fulfillPaidOrder({
      orderNo: order.orderNo,
      paymentMethod: "WECHAT",
      paymentId: result.transactionId,
      actor: { type: "callback" },
    });

    if (outcome.status === "invalid_state") {
      log.error("订单状态非待支付，拒绝履约:", order.orderNo, order.status);
      return new NextResponse(
        JSON.stringify({ code: "FAIL", message: "订单状态异常" }),
        { status: 400 }
      );
    }

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
