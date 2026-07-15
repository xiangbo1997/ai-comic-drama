import { formatApiError } from "@/lib/error-copy";

export interface PaymentMethod {
  id: string;
  name: string;
  icon: string;
}

export interface PaymentInfo {
  methods: PaymentMethod[];
  packages: Array<{
    id: string;
    name: string;
    price: number;
    credits: number;
  }>;
  plans: Array<{
    id: string;
    name: string;
    price: number;
    credits: number;
    period: string;
  }>;
}

export const PACKAGES = [
  {
    id: "trial",
    name: "体验包",
    price: 9.9,
    credits: 100,
    description: "约1条完整漫剧",
    popular: false,
  },
  {
    id: "basic",
    name: "基础包",
    price: 49,
    credits: 600,
    description: "约5条漫剧",
    popular: true,
  },
  {
    id: "pro",
    name: "专业包",
    price: 199,
    credits: 3000,
    description: "约25条漫剧",
    popular: false,
  },
];

export const MONTHLY_PLANS = [
  {
    id: "monthly",
    name: "月度会员",
    price: 99,
    credits: 1500,
    description: "每月1500积分",
    period: "月",
  },
  {
    id: "yearly",
    name: "年度会员",
    price: 999,
    credits: 20000,
    description: "每月约1666积分",
    period: "年",
    discount: "省17%",
  },
];

export async function fetchCredits() {
  const res = await fetch("/api/user/credits");
  if (!res.ok) throw new Error("Failed to fetch credits");
  return res.json();
}

export async function fetchCheckinStatus() {
  const res = await fetch("/api/user/checkin");
  if (!res.ok) throw new Error("Failed to fetch checkin status");
  return res.json();
}

export async function fetchInviteInfo() {
  const res = await fetch("/api/user/invite");
  if (!res.ok) throw new Error("Failed to fetch invite info");
  return res.json();
}

export async function doCheckin() {
  const res = await fetch("/api/user/checkin", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(formatApiError(data, "签到失败，请稍后重试"));
  }
  return res.json();
}

export interface CreditTransactionItem {
  id: string;
  delta: number;
  balanceAfter: number;
  type: string;
  note: string | null;
  createdAt: string;
}

/** 积分流水类型 → 中文标签（与 lib/credits.ts 的 ChargeType/GrantType 对齐） */
export const TX_TYPE_LABELS: Record<string, string> = {
  GENERATE_IMAGE: "图片生成",
  GENERATE_VIDEO: "视频生成",
  GENERATE_TTS: "语音合成",
  GENERATE_REFERENCE: "参考图生成",
  GENERATE_SCRIPT: "脚本生成",
  PAYMENT: "充值",
  SUBSCRIPTION: "会员订阅",
  REFUND: "失败退款",
  CHECKIN: "每日签到",
  INVITE: "邀请奖励",
};

export async function fetchCreditTransactions(cursor: string | null): Promise<{
  transactions: CreditTransactionItem[];
  nextCursor: string | null;
}> {
  const res = await fetch(
    `/api/user/credit-transactions${cursor ? `?cursor=${cursor}` : ""}`
  );
  if (!res.ok) throw new Error("获取积分明细失败");
  return res.json();
}

/** 订单状态 → 中文文案（覆盖 OrderStatus enum 全部取值） */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "待支付",
  PAID: "已支付",
  CANCELLED: "已取消",
  REFUNDED: "已退款",
  EXPIRED: "已过期",
};

/** 支付方式 → 中文文案 */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  WECHAT: "微信支付",
  ALIPAY: "支付宝",
  STRIPE: "Stripe",
};

/** 最近订单项（与 /api/orders 返回字段对齐；amount 为字符串化 Decimal） */
export interface OrderItem {
  id: string;
  orderNo: string;
  type: string;
  productName: string;
  amount: string;
  credits: number;
  status: string;
  paymentMethod: string | null;
  paidAt: string | null;
  createdAt: string;
}

export async function fetchRecentOrders(): Promise<{ orders: OrderItem[] }> {
  const res = await fetch("/api/orders");
  if (!res.ok) throw new Error("获取订单列表失败");
  return res.json();
}

export async function fetchPaymentMethods(): Promise<PaymentInfo> {
  const res = await fetch("/api/payment/create");
  if (!res.ok) throw new Error("Failed to fetch payment methods");
  return res.json();
}

export async function createPayment(params: {
  type: "credits" | "subscription";
  productId: string;
  paymentMethod: string;
}) {
  const res = await fetch("/api/payment/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(formatApiError(data, "创建订单失败，请重试"));
  }
  return res.json();
}

export async function checkOrderStatus(orderNo: string) {
  const res = await fetch(`/api/payment/order/${orderNo}`);
  if (!res.ok) throw new Error("Failed to check order");
  return res.json();
}

/** 购买/订阅商品的统一形态（弹窗与 handlePurchase 共享） */
export interface SelectedProduct {
  type: "credits" | "subscription";
  id: string;
  name: string;
  price: number;
  credits: number;
}

/** 创建订单成功后的支付结果（二维码 / 跳转链接） */
export interface PaymentResult {
  orderNo: string;
  qrCode?: string;
  paymentUrl?: string;
}
