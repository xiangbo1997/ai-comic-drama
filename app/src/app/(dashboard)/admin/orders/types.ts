/**
 * 订单后台的前端契约与展示常量
 *
 * 与 `/api/admin/orders*` 的响应形状一一对应。金额是**字符串**（服务端把
 * Prisma Decimal 转成两位小数字符串），不要在前端 parseFloat 后再格式化——
 * 那会把「精确的分」变成浮点近似值。
 */

/** 订单状态（与 Prisma OrderStatus 对齐） */
export type OrderStatus =
  | "PENDING"
  | "PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "EXPIRED";

/** 订单类型（与 Prisma OrderType 对齐） */
export type OrderType = "CREDITS" | "SUBSCRIPTION";

/** 支付方式（与 Prisma PaymentMethod 对齐） */
export type PaymentMethod = "WECHAT" | "ALIPAY" | "STRIPE";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "待支付",
  PAID: "已支付",
  CANCELLED: "已取消",
  REFUNDED: "已退款",
  EXPIRED: "已过期",
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  CREDITS: "积分包",
  SUBSCRIPTION: "订阅",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  WECHAT: "微信支付",
  ALIPAY: "支付宝",
  STRIPE: "Stripe",
};

/** 列表行 */
export interface AdminOrder {
  id: string;
  orderNo: string;
  userId: string;
  userEmail: string;
  type: OrderType;
  productId: string;
  productName: string;
  /** 两位小数字符串，如 "39.90" */
  amount: string;
  credits: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  paymentId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface OrdersResponse {
  items: AdminOrder[];
  nextCursor: string | null;
  summary: {
    count: number;
    /** 已支付订单金额合计，两位小数字符串 */
    paidAmount: string;
  };
}

/** 详情接口里的关联积分流水 */
export interface OrderCreditTransaction {
  id: string;
  delta: number;
  balanceAfter: number;
  type: string;
  source: string | null;
  note: string | null;
  createdAt: string;
}

/** 详情接口里的审计日志 */
export interface OrderAuditLog {
  id: string;
  action: string;
  before: unknown;
  after: unknown;
  note: string | null;
  ip: string | null;
  createdAt: string;
  actor: { id: string; email: string };
}

export interface OrderDetailResponse {
  order: AdminOrder & {
    subscriptionId: string | null;
    expiresAt: string | null;
    updatedAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string | null;
    credits: number;
    role: string;
    status: string;
    createdAt: string;
  };
  creditTransactions: OrderCreditTransaction[];
  auditLogs: OrderAuditLog[];
}

/** 统一的日期时间展示；无值显示破折号 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}
