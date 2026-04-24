/**
 * 创建支付订单 API
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  generateOrderNo,
  CREDIT_PACKAGES,
  SUBSCRIPTION_PLANS,
  wechatPay,
  alipay,
  stripe,
  getAvailablePaymentMethods,
  type PackageId,
  type PlanId,
  type PaymentMethod,
} from "@/services/payment";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:payment:create");

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 应用限流
    const rateLimitResult = await rateLimiters.payment(request, session.user.id);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    const {
      type,
      productId,
      paymentMethod,
    }: {
      type: "credits" | "subscription";
      productId: string;
      paymentMethod: PaymentMethod;
    } = await request.json();

    // 验证商品
    let productName: string;
    let amount: number;
    let credits: number;

    if (type === "credits") {
      const pkg = CREDIT_PACKAGES[productId as PackageId];
      if (!pkg) {
        return NextResponse.json({ error: "Invalid package" }, { status: 400 });
      }
      productName = pkg.name;
      amount = pkg.price;
      credits = pkg.credits;
    } else if (type === "subscription") {
      const plan = SUBSCRIPTION_PLANS[productId as PlanId];
      if (!plan) {
        return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
      }
      productName = plan.name;
      amount = plan.price;
      credits = plan.credits;
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    // 验证支付方式
    const availableMethods = getAvailablePaymentMethods();
    if (!availableMethods.includes(paymentMethod)) {
      return NextResponse.json(
        {
          error: "Payment method not available",
          available: availableMethods,
        },
        { status: 400 }
      );
    }

    // 生成订单号
    const orderNo = generateOrderNo();

    // 创建订单记录
    const order = await prisma.order.create({
      data: {
        orderNo,
        userId: session.user.id,
        type: type === "credits" ? "CREDITS" : "SUBSCRIPTION",
        productId,
        productName,
        amount,
        credits,
        status: "PENDING",
        paymentMethod,
      },
    });

    // 根据支付方式创建支付
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    let paymentResult;

    switch (paymentMethod) {
      case "WECHAT":
        paymentResult = await wechatPay.createNativeOrder({
          orderNo,
          amount,
          description: `AI漫剧 - ${productName}`,
        });
        break;

      case "ALIPAY":
        paymentResult = await alipay.createPageOrder({
          orderNo,
          amount,
          subject: `AI漫剧 - ${productName}`,
        });
        break;

      case "STRIPE":
        paymentResult = await stripe.createCheckoutSession({
          orderNo,
          amount,
          productName: `AI Comic - ${productName}`,
          successUrl: `${baseUrl}/credits?payment=success&order=${orderNo}`,
          cancelUrl: `${baseUrl}/credits?payment=cancelled`,
        });
        break;

      default:
        return NextResponse.json(
          { error: "Unsupported payment method" },
          { status: 400 }
        );
    }

    if (!paymentResult.success) {
      // 更新订单状态为失败
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
      });

      return NextResponse.json(
        { error: paymentResult.error || "Payment creation failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      orderId: order.id,
      orderNo,
      paymentUrl: paymentResult.paymentUrl,
      qrCode: paymentResult.qrCode,
      amount,
      credits,
    });
  } catch (error) {
    log.error("Create payment error:", error);
    return NextResponse.json(
      { error: "Failed to create payment" },
      { status: 500 }
    );
  }
}

// 获取可用支付方式
export async function GET() {
  try {
    const methods = getAvailablePaymentMethods();

    return NextResponse.json({
      methods: methods.map((m) => ({
        id: m,
        name:
          m === "WECHAT"
            ? "微信支付"
            : m === "ALIPAY"
              ? "支付宝"
              : "Stripe",
        icon:
          m === "WECHAT"
            ? "wechat"
            : m === "ALIPAY"
              ? "alipay"
              : "credit-card",
      })),
      packages: Object.values(CREDIT_PACKAGES),
      plans: Object.values(SUBSCRIPTION_PLANS),
    });
  } catch (error) {
    log.error("Get payment methods error:", error);
    return NextResponse.json(
      { error: "Failed to get payment methods" },
      { status: 500 }
    );
  }
}
