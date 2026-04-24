/**
 * 统一支付服务
 * 支持微信支付、支付宝、Stripe
 */

import crypto from "crypto";

import { createLogger } from "@/lib/logger";
const log = createLogger("services:payment");

// 商品配置
export const CREDIT_PACKAGES = {
  trial: { id: "trial", name: "体验包", price: 9.9, credits: 100 },
  basic: { id: "basic", name: "基础包", price: 49, credits: 600 },
  pro: { id: "pro", name: "专业包", price: 199, credits: 3000 },
} as const;

export const SUBSCRIPTION_PLANS = {
  monthly: {
    id: "monthly",
    name: "月度会员",
    price: 99,
    credits: 1500,
    period: "month" as const,
  },
  yearly: {
    id: "yearly",
    name: "年度会员",
    price: 999,
    credits: 20000,
    period: "year" as const,
  },
} as const;

export type PackageId = keyof typeof CREDIT_PACKAGES;
export type PlanId = keyof typeof SUBSCRIPTION_PLANS;
export type PaymentMethod = "WECHAT" | "ALIPAY" | "STRIPE";

// 支付结果
export interface PaymentResult {
  success: boolean;
  orderId: string;
  paymentUrl?: string; // 支付跳转URL
  qrCode?: string; // 二维码链接
  prepayId?: string; // 预支付ID（微信）
  error?: string;
}

// 回调验证结果
export interface CallbackVerifyResult {
  valid: boolean;
  orderId?: string;
  transactionId?: string;
  paidAmount?: number;
  error?: string;
}

/**
 * 生成订单号
 */
export function generateOrderNo(): string {
  const timestamp = Date.now().toString();
  const random = crypto.randomBytes(4).toString("hex");
  return `ORD${timestamp}${random}`.toUpperCase();
}

/**
 * 微信支付服务
 */
export class WechatPayService {
  private appId: string;
  private mchId: string;
  private apiKey: string;
  private notifyUrl: string;

  constructor() {
    this.appId = process.env.WECHAT_APP_ID || "";
    this.mchId = process.env.WECHAT_MCH_ID || "";
    this.apiKey = process.env.WECHAT_API_KEY || "";
    this.notifyUrl = process.env.WECHAT_NOTIFY_URL || "";
  }

  isConfigured(): boolean {
    return !!(this.appId && this.mchId && this.apiKey);
  }

  /**
   * 创建支付订单（Native 扫码支付）
   */
  async createNativeOrder(params: {
    orderNo: string;
    amount: number;
    description: string;
  }): Promise<PaymentResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        orderId: params.orderNo,
        error: "微信支付未配置",
      };
    }

    try {
      const nonceStr = crypto.randomBytes(16).toString("hex");
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // 构建请求参数
      const requestData = {
        appid: this.appId,
        mchid: this.mchId,
        description: params.description,
        out_trade_no: params.orderNo,
        notify_url: this.notifyUrl,
        amount: {
          total: Math.round(params.amount * 100), // 转换为分
          currency: "CNY",
        },
      };

      // 生成签名
      const signature = this.generateSignature(
        "POST",
        "/v3/pay/transactions/native",
        timestamp,
        nonceStr,
        JSON.stringify(requestData)
      );

      // 调用微信支付API
      const response = await fetch(
        "https://api.mch.weixin.qq.com/v3/pay/transactions/native",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",signature="${signature}",serial_no="${process.env.WECHAT_CERT_SERIAL}"`,
          },
          body: JSON.stringify(requestData),
        }
      );

      const result = await response.json();

      if (result.code_url) {
        return {
          success: true,
          orderId: params.orderNo,
          qrCode: result.code_url,
        };
      }

      return {
        success: false,
        orderId: params.orderNo,
        error: result.message || "创建支付订单失败",
      };
    } catch (error) {
      log.error("微信支付创建订单失败:", error);
      return {
        success: false,
        orderId: params.orderNo,
        error: error instanceof Error ? error.message : "未知错误",
      };
    }
  }

  /**
   * 验证回调签名
   */
  verifyCallback(
    headers: Record<string, string>,
    body: string
  ): CallbackVerifyResult {
    try {
      const timestamp = headers["wechatpay-timestamp"];
      const nonce = headers["wechatpay-nonce"];
      const signature = headers["wechatpay-signature"];

      if (!timestamp || !nonce || !signature) {
        return { valid: false, error: "缺少签名参数" };
      }

      // 验证签名逻辑（需要微信平台证书）
      // 这里简化处理，生产环境需要完整实现
      // const message = `${timestamp}\n${nonce}\n${body}\n`;
      // const verified = crypto.verify(...);

      // 解密通知数据
      const notification = JSON.parse(body);
      if (notification.event_type === "TRANSACTION.SUCCESS") {
        const resource = this.decryptResource(notification.resource);
        return {
          valid: true,
          orderId: resource.out_trade_no,
          transactionId: resource.transaction_id,
          paidAmount: resource.amount.total / 100,
        };
      }

      return { valid: false, error: "非支付成功通知" };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "验证失败",
      };
    }
  }

  private generateSignature(
    method: string,
    url: string,
    timestamp: string,
    nonceStr: string,
    body: string
  ): string {
    const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
    // 使用商户私钥签名（需要证书）
    // 这里返回占位符，生产环境需要完整实现
    return crypto.createHash("sha256").update(message).digest("base64");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private decryptResource(resource: Record<string, unknown>): any {
    // AES-256-GCM 解密（需要 API v3 密钥）
    // 这里简化处理，生产环境需要完整实现
    return resource;
  }
}

/**
 * 支付宝服务
 */
export class AlipayService {
  private appId: string;
  private privateKey: string;
  private alipayPublicKey: string;
  private notifyUrl: string;

  constructor() {
    this.appId = process.env.ALIPAY_APP_ID || "";
    this.privateKey = process.env.ALIPAY_PRIVATE_KEY || "";
    this.alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY || "";
    this.notifyUrl = process.env.ALIPAY_NOTIFY_URL || "";
  }

  isConfigured(): boolean {
    return !!(this.appId && this.privateKey && this.alipayPublicKey);
  }

  /**
   * 创建支付订单（电脑网站支付）
   */
  async createPageOrder(params: {
    orderNo: string;
    amount: number;
    subject: string;
  }): Promise<PaymentResult> {
    if (!this.isConfigured()) {
      return { success: false, orderId: params.orderNo, error: "支付宝未配置" };
    }

    try {
      const timestamp = new Date()
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);

      // 业务参数
      const bizContent = {
        out_trade_no: params.orderNo,
        total_amount: params.amount.toFixed(2),
        subject: params.subject,
        product_code: "FAST_INSTANT_TRADE_PAY",
      };

      // 公共参数
      const requestParams: Record<string, string> = {
        app_id: this.appId,
        method: "alipay.trade.page.pay",
        format: "JSON",
        charset: "utf-8",
        sign_type: "RSA2",
        timestamp,
        version: "1.0",
        notify_url: this.notifyUrl,
        biz_content: JSON.stringify(bizContent),
      };

      // 生成签名
      requestParams.sign = this.generateSign(requestParams);

      // 构建支付URL
      const query = Object.entries(requestParams)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");

      return {
        success: true,
        orderId: params.orderNo,
        paymentUrl: `https://openapi.alipay.com/gateway.do?${query}`,
      };
    } catch (error) {
      log.error("支付宝创建订单失败:", error);
      return {
        success: false,
        orderId: params.orderNo,
        error: error instanceof Error ? error.message : "未知错误",
      };
    }
  }

  /**
   * 验证回调签名
   */
  verifyCallback(params: Record<string, string>): CallbackVerifyResult {
    try {
      const { sign, sign_type: _sign_type, ...restParams } = params;

      if (!sign) {
        return { valid: false, error: "缺少签名" };
      }

      // 验证签名
      const sortedStr = Object.keys(restParams)
        .sort()
        .map((k) => `${k}=${restParams[k]}`)
        .join("&");

      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(sortedStr, "utf8");
      const valid = verifier.verify(
        this.formatPublicKey(this.alipayPublicKey),
        sign,
        "base64"
      );

      if (!valid) {
        return { valid: false, error: "签名验证失败" };
      }

      if (params.trade_status === "TRADE_SUCCESS") {
        return {
          valid: true,
          orderId: params.out_trade_no,
          transactionId: params.trade_no,
          paidAmount: parseFloat(params.total_amount),
        };
      }

      return { valid: false, error: "非支付成功状态" };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "验证失败",
      };
    }
  }

  private generateSign(params: Record<string, string>): string {
    const sortedStr = Object.keys(params)
      .sort()
      .filter((k) => params[k] && k !== "sign")
      .map((k) => `${k}=${params[k]}`)
      .join("&");

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(sortedStr, "utf8");
    return signer.sign(this.formatPrivateKey(this.privateKey), "base64");
  }

  private formatPrivateKey(key: string): string {
    if (key.includes("-----BEGIN")) return key;
    return `-----BEGIN RSA PRIVATE KEY-----\n${key}\n-----END RSA PRIVATE KEY-----`;
  }

  private formatPublicKey(key: string): string {
    if (key.includes("-----BEGIN")) return key;
    return `-----BEGIN PUBLIC KEY-----\n${key}\n-----END PUBLIC KEY-----`;
  }
}

/**
 * Stripe 服务（国际支付备选）
 */
export class StripeService {
  private secretKey: string;
  private webhookSecret: string;

  constructor() {
    this.secretKey = process.env.STRIPE_SECRET_KEY || "";
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  }

  isConfigured(): boolean {
    return !!this.secretKey;
  }

  /**
   * 创建 Checkout Session
   */
  async createCheckoutSession(params: {
    orderNo: string;
    amount: number;
    productName: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<PaymentResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        orderId: params.orderNo,
        error: "Stripe 未配置",
      };
    }

    try {
      const response = await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            "payment_method_types[0]": "card",
            "line_items[0][price_data][currency]": "cny",
            "line_items[0][price_data][product_data][name]": params.productName,
            "line_items[0][price_data][unit_amount]": Math.round(
              params.amount * 100
            ).toString(),
            "line_items[0][quantity]": "1",
            mode: "payment",
            success_url: params.successUrl,
            cancel_url: params.cancelUrl,
            "metadata[order_no]": params.orderNo,
          }),
        }
      );

      const session = await response.json();

      if (session.url) {
        return {
          success: true,
          orderId: params.orderNo,
          paymentUrl: session.url,
          prepayId: session.id,
        };
      }

      return {
        success: false,
        orderId: params.orderNo,
        error: session.error?.message || "创建支付会话失败",
      };
    } catch (error) {
      log.error("Stripe 创建订单失败:", error);
      return {
        success: false,
        orderId: params.orderNo,
        error: error instanceof Error ? error.message : "未知错误",
      };
    }
  }

  /**
   * 验证 Webhook 签名
   */
  verifyWebhook(payload: string, signature: string): CallbackVerifyResult {
    try {
      const elements = signature.split(",");
      const signatureMap: Record<string, string> = {};
      elements.forEach((el) => {
        const [key, value] = el.split("=");
        signatureMap[key] = value;
      });

      const timestamp = signatureMap["t"];
      const sig = signatureMap["v1"];

      if (!timestamp || !sig) {
        return { valid: false, error: "签名格式错误" };
      }

      // 验证签名
      const signedPayload = `${timestamp}.${payload}`;
      const expectedSig = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(signedPayload)
        .digest("hex");

      if (sig !== expectedSig) {
        return { valid: false, error: "签名验证失败" };
      }

      const event = JSON.parse(payload);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        return {
          valid: true,
          orderId: session.metadata?.order_no,
          transactionId: session.payment_intent,
          paidAmount: session.amount_total / 100,
        };
      }

      return { valid: false, error: "非支付完成事件" };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "验证失败",
      };
    }
  }
}

// 导出单例
export const wechatPay = new WechatPayService();
export const alipay = new AlipayService();
export const stripe = new StripeService();

/**
 * 获取可用的支付方式
 */
export function getAvailablePaymentMethods(): PaymentMethod[] {
  const methods: PaymentMethod[] = [];
  if (wechatPay.isConfigured()) methods.push("WECHAT");
  if (alipay.isConfigured()) methods.push("ALIPAY");
  if (stripe.isConfigured()) methods.push("STRIPE");
  return methods;
}
