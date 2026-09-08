/**
 * 订单履约（发放积分 / 建订阅 / 退款）的单一真源
 *
 * 三个支付回调（微信 / 支付宝 / Stripe）此前各抄了一份「条件抢占 + 发放积分 +
 * 建订阅」的逻辑，三份共 60 余行且已经出现细节漂移风险（订阅周期算法、流水
 * sourceId、回退分支）。资金路径上的三份拷贝迟早会各自演化出不同的 bug，故
 * 收口到本模块，回调只保留各自的**验签与响应格式**。
 *
 * ## 履约的幂等模型（与回调原实现完全一致，勿改语义）
 *
 * 1. **条件抢占**：`updateMany({ where: { orderNo, status: "PENDING" } })`。
 *    这是幂等闸门——网关重试时第二次起 `count === 0`，直接返回 `already_paid`。
 *    刻意用 updateMany 而非 update：update 找不到匹配行会抛 P2025，而这里
 *    「没抢到」是正常路径不是异常。
 * 2. **发放事务**：抢占成功后开 `$transaction` 发积分（+ 订阅记录），保证
 *    积分与订阅同生共死。
 * 3. **失败回退**：事务失败时把订单退回 PENDING（含清空 paymentId/paidAt），
 *    让网关下次重试能重新走完整流程；回退本身失败只打日志（需人工介入）。
 *
 * ⚠️ 抢占与发放**不在同一事务**里，这是原实现的有意取舍：抢占必须尽早提交
 * 以阻断并发的第二个回调，否则两个事务都读不到对方未提交的 UPDATE 而双发。
 * 代价就是上面第 3 步的补偿回退。
 *
 * ## 退款
 *
 * `refundOrder` 只改本地状态（PAID → REFUNDED）并可选扣回积分。**不调用任何
 * 支付渠道的退款接口**——真实退款需要在微信商户平台 / 支付宝商家中心 /
 * Stripe Dashboard 里人工操作。本函数记录的是「账已经在渠道退过了，把系统内
 * 的订单与积分对齐」这一动作。
 */

import { Prisma } from "@prisma/client";
import type { Order, PaymentMethod } from "@prisma/client";

import { writeAuditLog } from "@/lib/admin-audit";
import { chargeCredits, grantCredits } from "@/lib/credits";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("lib:orders");

/** 履约操作者：网关回调，或后台管理员手工标记 */
export type FulfillActor =
  | { type: "callback" }
  | { type: "admin"; adminId: string; note?: string; ip?: string };

export interface FulfillPaidOrderParams {
  /** 订单号（业务主键，回调里由验签结果给出） */
  orderNo: string;
  /** 支付方式，同时用作积分流水的 source（小写） */
  paymentMethod: PaymentMethod;
  /** 渠道流水号 */
  paymentId?: string;
  /** 支付时间；缺省取当前时刻 */
  paidAt?: Date;
  actor?: FulfillActor;
}

/**
 * 履约结果状态
 *
 * - `fulfilled`：本次抢占成功且积分已发放
 * - `already_paid`：订单已被处理过（网关重试 / 并发回调），幂等成功
 * - `not_found`：订单号不存在
 * - `invalid_state`：订单存在但不是 PENDING（已取消 / 已退款 / 已过期）
 */
export type FulfillStatus =
  | "fulfilled"
  | "already_paid"
  | "not_found"
  | "invalid_state";

export interface FulfillPaidOrderResult {
  status: FulfillStatus;
  /** 命中的订单（not_found 时为 undefined） */
  order?: Order;
}

/** 积分流水的 source 字段：与回调原实现一致，用小写渠道名 */
const PAYMENT_SOURCE: Record<PaymentMethod, string> = {
  WECHAT: "wechat",
  ALIPAY: "alipay",
  STRIPE: "stripe",
};

/**
 * 按 productId 推算订阅周期结束时间。
 *
 * 与回调原实现逐字一致：只认 `monthly` / `yearly`，其他 productId 的
 * periodEnd 等于 periodStart（即立即到期）。这看着像 bug，但改动它会影响
 * 既有订阅的到期判定，属于独立的产品决策，不在本次收口范围内。
 */
function computePeriodEnd(productId: string, start: Date): Date {
  const periodEnd = new Date(start);
  if (productId === "monthly") {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else if (productId === "yearly") {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }
  return periodEnd;
}

/**
 * 履约一笔已支付订单：抢占订单 → 发放积分（+ 订阅）。
 *
 * 调用方（回调）需自行完成验签与金额校验；本函数只负责状态机与发放。
 *
 * @throws 发放事务失败且已回退订单状态后，把原始错误上抛给调用方决定响应码
 */
export async function fulfillPaidOrder(
  params: FulfillPaidOrderParams
): Promise<FulfillPaidOrderResult> {
  const { orderNo, paymentMethod, paymentId, actor } = params;
  const paidAt = params.paidAt ?? new Date();

  const order = await prisma.order.findUnique({ where: { orderNo } });

  if (!order) {
    return { status: "not_found" };
  }

  // 已是 PAID：网关重试的典型形态，幂等成功
  if (order.status === "PAID") {
    return { status: "already_paid", order };
  }

  // 已取消 / 已退款 / 已过期：不是可履约状态，明确拒绝而非静默放过
  if (order.status !== "PENDING") {
    return { status: "invalid_state", order };
  }

  // 幂等闸门：条件原子更新，只有 PENDING → PAID 抢占成功的一次才发放积分
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: "PENDING" },
    data: {
      status: "PAID",
      paymentId: paymentId ?? null,
      paidAt,
    },
  });

  if (claimed.count === 0) {
    // 上面的读与这里的写之间被别的回调抢先了，同样按幂等处理
    log.info(`订单已处理过，幂等返回: ${order.orderNo}`);
    return { status: "already_paid", order };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 发放积分 + 记流水
      await grantCredits(tx, {
        userId: order.userId,
        amount: order.credits,
        type: order.type === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PAYMENT",
        source: PAYMENT_SOURCE[paymentMethod],
        // sourceId 用 order.id（非 orderNo）——与三个回调原实现一致，
        // 也是 CreditTransaction 幂等唯一索引实际承载的值，勿改。
        sourceId: order.id,
        note: `订单 ${order.orderNo} 支付到账`,
      });

      // 订阅订单额外建订阅记录并回写到期时间
      if (order.type === "SUBSCRIPTION") {
        const now = new Date();
        const periodEnd = computePeriodEnd(order.productId, now);

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

      // 管理员手工标记：审计日志与发放同事务，避免「发了钱没日志」
      if (actor?.type === "admin") {
        await writeAuditLog(tx, {
          actorId: actor.adminId,
          action: "order.mark_paid",
          targetType: "order",
          targetId: order.id,
          before: { status: order.status, paidAt: null },
          after: {
            status: "PAID",
            paymentMethod,
            paymentId: paymentId ?? null,
            credits: order.credits,
          },
          note: actor.note,
          ip: actor.ip,
        });
      }
    });
  } catch (txError) {
    // 事务失败：积分/订阅未落库，但订单已被标记 PAID。
    // 回退订单状态为 PENDING 以便网关重试时重新发放。
    log.error("订单积分发放事务失败，回退订单状态:", txError);
    try {
      await prisma.order.updateMany({
        where: { id: order.id, status: "PAID" },
        data: { status: "PENDING", paymentId: null, paidAt: null },
      });
    } catch (rollbackError) {
      log.error("回退订单状态失败，需人工介入:", rollbackError);
    }
    throw txError;
  }

  log.info(`订单支付成功: ${order.orderNo}, 发放 ${order.credits} 积分`);

  return { status: "fulfilled", order };
}

/** 并发退款抢占失败的内部信号；仅用于回滚事务，不外泄给调用方 */
class ConcurrentRefundError extends Error {
  constructor() {
    super("订单已被并发退款处理");
    this.name = "ConcurrentRefundError";
    Object.setPrototypeOf(this, ConcurrentRefundError.prototype);
  }
}

/** 判定是否为并发退款信号 */
function isConcurrentRefundError(error: unknown): boolean {
  return error instanceof ConcurrentRefundError;
}

/** 退款结果状态 */
export type RefundStatus =
  | "refunded"
  | "not_found"
  | "invalid_state"
  | "already_refunded";

export interface RefundOrderResult {
  status: RefundStatus;
  order?: Order;
  /** 实际扣回的积分（余额不足时小于订单积分；未选择扣减时为 0） */
  clawedBack?: number;
}

export interface RefundOrderParams {
  orderNo: string;
  adminId: string;
  reason: string;
  /** 是否同时扣回已发放的积分 */
  deductCredits: boolean;
  ip?: string;
}

/**
 * 订单退款：PAID → REFUNDED，可选扣回积分。
 *
 * **不发起渠道退款**：钱要在微信商户平台 / 支付宝商家中心 / Stripe Dashboard
 * 里人工退。本函数只把系统内的账对齐，并留审计。
 *
 * 扣减采用 `min(order.credits, user.credits)`：用户可能已经把积分花掉一部分，
 * 强扣到负数会让后续所有扣费校验（`credits < amount`）永久失败。少扣的部分
 * 记在审计日志的 `after.clawedBack` 与 `after.shortfall` 里，供人工追讨。
 */
export async function refundOrder(
  params: RefundOrderParams
): Promise<RefundOrderResult> {
  const { orderNo, adminId, reason, deductCredits, ip } = params;

  const order = await prisma.order.findUnique({ where: { orderNo } });

  if (!order) {
    return { status: "not_found" };
  }

  if (order.status === "REFUNDED") {
    return { status: "already_refunded", order };
  }

  // 只有真正收到过钱的订单才谈得上退款
  if (order.status !== "PAID") {
    return { status: "invalid_state", order };
  }

  let clawedBack = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // 条件更新：并发两次退款只有一次能把 PAID 翻成 REFUNDED
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: "PAID" },
        data: { status: "REFUNDED" },
      });

      if (claimed.count === 0) {
        // 已被并发的另一次退款处理，抛错回滚本事务（下方 catch 翻译成幂等结果）
        throw new ConcurrentRefundError();
      }

      if (deductCredits) {
        const user = await tx.user.findUnique({
          where: { id: order.userId },
          select: { credits: true },
        });
        const available = user?.credits ?? 0;
        // 绝不扣成负数：用户可能已消费掉部分积分
        clawedBack = Math.min(order.credits, available);

        if (clawedBack > 0) {
          await chargeCredits(tx, {
            userId: order.userId,
            amount: clawedBack,
            type: "ADMIN_DEDUCT",
            source: "admin:refund",
            sourceId: order.id,
            note: `订单 ${order.orderNo} 退款扣回`,
          });
        }
      }

      await writeAuditLog(tx, {
        actorId: adminId,
        action: "order.refund",
        targetType: "order",
        targetId: order.id,
        before: { status: order.status, credits: order.credits },
        after: {
          status: "REFUNDED",
          deductCredits,
          clawedBack,
          // 想扣但没扣够的差额，人工追讨的依据
          shortfall: deductCredits ? order.credits - clawedBack : 0,
        },
        note: reason,
        ip,
      });
    });
  } catch (error) {
    if (isConcurrentRefundError(error)) {
      // 事务已回滚，订单由另一次退款处理完毕，按幂等返回
      return { status: "already_refunded", order };
    }
    throw error;
  }

  log.info(
    `订单退款完成: ${order.orderNo}, 扣回 ${clawedBack} 积分（deductCredits=${deductCredits}）`
  );

  return { status: "refunded", order, clawedBack };
}

/** 把 Prisma Decimal 金额转成前端可用的字符串（避免浮点精度损失） */
export function serializeAmount(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}
