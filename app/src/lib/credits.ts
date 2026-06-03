import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * 统一积分服务
 *
 * 所有积分变动都必须经过本模块，保证：
 * 1. 余额变动与流水写入在同一事务内完成（原子性）
 * 2. 每条流水都带变动后余额快照（balanceAfter），便于审计与对账
 * 3. 退款幂等：相同 sourceId 的 REFUND 只生效一次
 *
 * 分层约束：本模块属于 lib 层，仅依赖 @/lib/prisma，不反向依赖 services/app。
 */

/** 扣费类型（生成类业务） */
export type ChargeType =
  | "GENERATE_IMAGE"
  | "GENERATE_VIDEO"
  | "GENERATE_TTS"
  | "GENERATE_REFERENCE";

/** 发放类型（充值/订阅/签到/邀请奖励） */
export type GrantType = "PAYMENT" | "SUBSCRIPTION" | "CHECKIN" | "INVITE";

/**
 * 积分不足异常
 *
 * chargeCredits 在余额不足时抛出；调用方可 catch 此类型并返回 HTTP 400。
 */
export class InsufficientCreditsError extends Error {
  /** 用户当前余额 */
  readonly available: number;
  /** 本次需要扣减的积分 */
  readonly required: number;

  constructor(available: number, required: number) {
    super(`积分不足：当前余额 ${available}，需要 ${required}`);
    this.name = "InsufficientCreditsError";
    this.available = available;
    this.required = required;

    // 修正原型链，保证 instanceof 在编译目标较低时仍可用
    Object.setPrototypeOf(this, InsufficientCreditsError.prototype);
  }
}

/** 校验扣减/发放金额必须为正整数 */
function assertPositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`积分变动金额必须为正整数，收到：${amount}`);
  }
}

/**
 * 事务内扣费
 *
 * 在传入的事务上下文中：
 * 1. 读取当前余额，校验是否足够（不足则抛 InsufficientCreditsError）
 * 2. 扣减 user.credits（decrement）并取回变动后余额
 * 3. 写一条 delta 为负的流水（带 balanceAfter 快照）
 *
 * 必须由调用方在 prisma.$transaction 中调用，以保证扣费与业务写入的原子性。
 */
export async function chargeCredits(
  tx: Prisma.TransactionClient,
  p: {
    userId: string;
    amount: number;
    type: ChargeType;
    source: string;
    sourceId?: string;
    note?: string;
  }
): Promise<void> {
  assertPositiveAmount(p.amount);

  // 在同一事务内读取当前余额，避免脏读
  const user = await tx.user.findUnique({
    where: { id: p.userId },
    select: { credits: true },
  });

  if (!user) {
    throw new Error(`用户不存在：${p.userId}`);
  }

  if (user.credits < p.amount) {
    throw new InsufficientCreditsError(user.credits, p.amount);
  }

  // 扣减并取回变动后余额作为快照
  const updated = await tx.user.update({
    where: { id: p.userId },
    data: { credits: { decrement: p.amount } },
    select: { credits: true },
  });

  await tx.creditTransaction.create({
    data: {
      userId: p.userId,
      delta: -p.amount,
      balanceAfter: updated.credits,
      type: p.type,
      source: p.source,
      sourceId: p.sourceId ?? null,
      note: p.note ?? null,
    },
  });
}

/**
 * 退款（自带独立事务 + 幂等）
 *
 * 1. 幂等：若已存在相同 sourceId 且 type=REFUND 的流水，直接跳过
 * 2. 增加 user.credits（increment）并取回变动后余额
 * 3. 写一条 type=REFUND、delta 为正的流水（带 balanceAfter 快照）
 *
 * 本函数内部开启 prisma.$transaction，调用方无需再包事务。
 */
export async function refundCredits(p: {
  userId: string;
  amount: number;
  source: string;
  sourceId?: string;
  note?: string;
}): Promise<void> {
  assertPositiveAmount(p.amount);

  await prisma.$transaction(async (tx) => {
    // 幂等校验：仅当提供 sourceId 时才能去重
    if (p.sourceId) {
      const existing = await tx.creditTransaction.findFirst({
        where: {
          userId: p.userId,
          sourceId: p.sourceId,
          type: "REFUND",
        },
        select: { id: true },
      });

      if (existing) {
        // 已退款，跳过，保证幂等
        return;
      }
    }

    const updated = await tx.user.update({
      where: { id: p.userId },
      data: { credits: { increment: p.amount } },
      select: { credits: true },
    });

    await tx.creditTransaction.create({
      data: {
        userId: p.userId,
        delta: p.amount,
        balanceAfter: updated.credits,
        type: "REFUND",
        source: p.source,
        sourceId: p.sourceId ?? null,
        note: p.note ?? null,
      },
    });
  });
}

/**
 * 事务内发放
 *
 * 在传入的事务上下文中：
 * 1. 增加 user.credits（increment）并取回变动后余额
 * 2. 写一条 delta 为正的流水（带 balanceAfter 快照）
 *
 * 用于充值（PAYMENT）/ 订阅周期发放（SUBSCRIPTION），必须由调用方在
 * prisma.$transaction 中调用，以保证发放与订单/订阅写入的原子性。
 */
export async function grantCredits(
  tx: Prisma.TransactionClient,
  p: {
    userId: string;
    amount: number;
    type: GrantType;
    source: string;
    sourceId?: string;
    note?: string;
  }
): Promise<void> {
  assertPositiveAmount(p.amount);

  const updated = await tx.user.update({
    where: { id: p.userId },
    data: { credits: { increment: p.amount } },
    select: { credits: true },
  });

  await tx.creditTransaction.create({
    data: {
      userId: p.userId,
      delta: p.amount,
      balanceAfter: updated.credits,
      type: p.type,
      source: p.source,
      sourceId: p.sourceId ?? null,
      note: p.note ?? null,
    },
  });
}
