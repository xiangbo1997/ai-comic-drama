/**
 * 订单履约与退款单测（资金路径）
 *
 * 手搓 prisma mock，覆盖 lib/orders.ts 的两个状态机：
 *
 * 1. fulfillPaidOrder：PENDING → fulfilled（且只发一次）、重复调用 already_paid、
 *    订单不存在 not_found、CANCELLED 等非法状态 invalid_state。
 *    重点断言「幂等闸门是条件 updateMany」——抢不到就一分钱都不能发。
 * 2. refundOrder：扣回额取 min(订单积分, 用户余额)，绝不把余额扣成负数；
 *    差额写进审计日志的 shortfall 供人工追讨。
 *
 * 这些不变量一旦破掉就是真金白银的损失（重复发放 / 余额变负导致账号锁死），
 * 所以断言写得比较死：不只看「有没有调」，也看调用参数逐字段。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock 依赖：prisma / credits / admin-audit / logger ──
type MockTx = {
  user: { findUnique: ReturnType<typeof vi.fn> };
  order: {
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  subscription: { create: ReturnType<typeof vi.fn> };
};

const tx: MockTx = {
  user: { findUnique: vi.fn() },
  order: { update: vi.fn(), updateMany: vi.fn() },
  subscription: { create: vi.fn() },
};

const orderFindUnique = vi.fn();
const orderUpdateMany = vi.fn();
const transactionMock = vi.fn(
  async (fn: (client: MockTx) => Promise<unknown>) => fn(tx)
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findUnique: (args: unknown) => orderFindUnique(args),
      updateMany: (args: unknown) => orderUpdateMany(args),
    },
    $transaction: (fn: (client: MockTx) => Promise<unknown>) =>
      transactionMock(fn),
  },
}));

const grantCredits = vi.fn();
const chargeCredits = vi.fn();
vi.mock("@/lib/credits", () => ({
  grantCredits: (...args: unknown[]) => grantCredits(...args),
  chargeCredits: (...args: unknown[]) => chargeCredits(...args),
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/admin-audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { fulfillPaidOrder, refundOrder } from "@/lib/orders";

/** 造一笔积分包订单；覆盖字段用 overrides 传入 */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-id-1",
    orderNo: "NO20260908001",
    userId: "u1",
    type: "CREDITS",
    productId: "pack-1000",
    productName: "1000 积分包",
    credits: 1000,
    status: "PENDING",
    paymentMethod: null,
    paymentId: null,
    paidAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  orderFindUnique.mockReset();
  orderUpdateMany.mockReset();
  tx.user.findUnique.mockReset();
  tx.order.update.mockReset();
  tx.order.updateMany.mockReset();
  tx.subscription.create.mockReset();
  grantCredits.mockReset();
  chargeCredits.mockReset();
  writeAuditLog.mockReset();
});

describe("fulfillPaidOrder — 履约状态机", () => {
  it("PENDING 订单：抢占成功 → 发放积分 → fulfilled", async () => {
    orderFindUnique.mockResolvedValue(makeOrder());
    orderUpdateMany.mockResolvedValue({ count: 1 });

    const result = await fulfillPaidOrder({
      orderNo: "NO20260908001",
      paymentMethod: "WECHAT",
      paymentId: "wx-txn-9",
    });

    expect(result.status).toBe("fulfilled");

    // 幂等闸门必须是条件 updateMany（where 带 status: PENDING）
    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-id-1", status: "PENDING" },
        data: expect.objectContaining({
          status: "PAID",
          paymentId: "wx-txn-9",
        }),
      })
    );

    // 发放类型 PAYMENT，sourceId 用 order.id（与三个回调原实现一致）
    expect(grantCredits).toHaveBeenCalledTimes(1);
    expect(grantCredits).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: "u1",
        amount: 1000,
        type: "PAYMENT",
        source: "wechat",
        sourceId: "order-id-1",
      })
    );

    // 非订阅订单不建订阅
    expect(tx.subscription.create).not.toHaveBeenCalled();
  });

  it("第二次调用（订单已 PAID）：already_paid，一分钱都不再发", async () => {
    orderFindUnique.mockResolvedValue(makeOrder({ status: "PAID" }));

    const result = await fulfillPaidOrder({
      orderNo: "NO20260908001",
      paymentMethod: "WECHAT",
    });

    expect(result.status).toBe("already_paid");
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("并发抢占失败（updateMany count=0）：already_paid，不发放", async () => {
    // 读到的是 PENDING，但写的时候被另一个回调抢先了
    orderFindUnique.mockResolvedValue(makeOrder());
    orderUpdateMany.mockResolvedValue({ count: 0 });

    const result = await fulfillPaidOrder({
      orderNo: "NO20260908001",
      paymentMethod: "STRIPE",
    });

    expect(result.status).toBe("already_paid");
    expect(grantCredits).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("订单不存在：not_found", async () => {
    orderFindUnique.mockResolvedValue(null);

    const result = await fulfillPaidOrder({
      orderNo: "NOPE",
      paymentMethod: "ALIPAY",
    });

    expect(result.status).toBe("not_found");
    expect(result.order).toBeUndefined();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("CANCELLED 订单：invalid_state，不履约", async () => {
    orderFindUnique.mockResolvedValue(makeOrder({ status: "CANCELLED" }));

    const result = await fulfillPaidOrder({
      orderNo: "NO20260908001",
      paymentMethod: "WECHAT",
    });

    expect(result.status).toBe("invalid_state");
    expect(result.order?.status).toBe("CANCELLED");
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("REFUNDED / EXPIRED 订单同样 invalid_state", async () => {
    for (const status of ["REFUNDED", "EXPIRED"]) {
      orderFindUnique.mockResolvedValue(makeOrder({ status }));
      const result = await fulfillPaidOrder({
        orderNo: "NO20260908001",
        paymentMethod: "WECHAT",
      });
      expect(result.status).toBe("invalid_state");
    }
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("订阅订单：发放类型 SUBSCRIPTION 且建订阅 + 回写到期时间", async () => {
    orderFindUnique.mockResolvedValue(
      makeOrder({ type: "SUBSCRIPTION", productId: "monthly" })
    );
    orderUpdateMany.mockResolvedValue({ count: 1 });

    const result = await fulfillPaidOrder({
      orderNo: "NO20260908001",
      paymentMethod: "ALIPAY",
    });

    expect(result.status).toBe("fulfilled");
    expect(grantCredits).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: "SUBSCRIPTION", source: "alipay" })
    );
    expect(tx.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        planId: "monthly",
        status: "ACTIVE",
        creditsPerPeriod: 1000,
      }),
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "order-id-1" } })
    );
  });

  it("monthly 订阅周期结束时间为一个月后", async () => {
    orderFindUnique.mockResolvedValue(
      makeOrder({ type: "SUBSCRIPTION", productId: "monthly" })
    );
    orderUpdateMany.mockResolvedValue({ count: 1 });

    await fulfillPaidOrder({
      orderNo: "NO20260908001",
      paymentMethod: "STRIPE",
    });

    const call = tx.subscription.create.mock.calls[0]?.[0] as {
      data: { currentPeriodStart: Date; currentPeriodEnd: Date };
    };
    const start = call.data.currentPeriodStart;
    const end = call.data.currentPeriodEnd;
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    // 一个月后：月份数 +1（跨年时取模）
    expect(end.getMonth()).toBe((start.getMonth() + 1) % 12);
  });

  it("管理员标记：同事务写 order.mark_paid 审计日志", async () => {
    orderFindUnique.mockResolvedValue(makeOrder());
    orderUpdateMany.mockResolvedValue({ count: 1 });

    await fulfillPaidOrder({
      orderNo: "NO20260908001",
      paymentMethod: "WECHAT",
      paymentId: "manual-1",
      actor: { type: "admin", adminId: "admin-1", note: "渠道已到账" },
    });

    expect(writeAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorId: "admin-1",
        action: "order.mark_paid",
        targetType: "order",
        targetId: "order-id-1",
        note: "渠道已到账",
      })
    );
  });

  it("回调履约不写审计日志（否则日志被网关流量淹没）", async () => {
    orderFindUnique.mockResolvedValue(makeOrder());
    orderUpdateMany.mockResolvedValue({ count: 1 });

    await fulfillPaidOrder({
      orderNo: "NO20260908001",
      paymentMethod: "WECHAT",
      actor: { type: "callback" },
    });

    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("发放事务失败：回退订单为 PENDING 并上抛原始错误", async () => {
    orderFindUnique.mockResolvedValue(makeOrder());
    orderUpdateMany.mockResolvedValue({ count: 1 });
    grantCredits.mockRejectedValue(new Error("db down"));

    await expect(
      fulfillPaidOrder({
        orderNo: "NO20260908001",
        paymentMethod: "WECHAT",
      })
    ).rejects.toThrow(/db down/);

    // 第二次 updateMany 就是回退：PAID → PENDING 且清空支付字段
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: "order-id-1", status: "PAID" },
      data: { status: "PENDING", paymentId: null, paidAt: null },
    });
  });
});

describe("refundOrder — 退款与扣回", () => {
  const paidOrder = () => makeOrder({ status: "PAID", credits: 1000 });

  it("余额充足：按订单积分全额扣回", async () => {
    orderFindUnique.mockResolvedValue(paidOrder());
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.user.findUnique.mockResolvedValue({ credits: 3000 });

    const result = await refundOrder({
      orderNo: "NO20260908001",
      adminId: "admin-1",
      reason: "用户申请退款",
      deductCredits: true,
    });

    expect(result.status).toBe("refunded");
    expect(result.clawedBack).toBe(1000);
    expect(chargeCredits).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: "u1",
        amount: 1000,
        type: "ADMIN_DEDUCT",
        sourceId: "order-id-1",
      })
    );
  });

  it("余额低于订单积分：只扣现有余额，绝不扣成负数", async () => {
    orderFindUnique.mockResolvedValue(paidOrder());
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    // 用户已经花掉 700，只剩 300
    tx.user.findUnique.mockResolvedValue({ credits: 300 });

    const result = await refundOrder({
      orderNo: "NO20260908001",
      adminId: "admin-1",
      reason: "部分消费后退款",
      deductCredits: true,
    });

    expect(result.clawedBack).toBe(300);
    expect(chargeCredits).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ amount: 300 })
    );
    // 差额 700 必须留在审计日志里供人工追讨
    expect(writeAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "order.refund",
        after: expect.objectContaining({ clawedBack: 300, shortfall: 700 }),
      })
    );
  });

  it("余额为 0：一次扣费都不发起（chargeCredits 会拒绝 amount=0）", async () => {
    orderFindUnique.mockResolvedValue(paidOrder());
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.user.findUnique.mockResolvedValue({ credits: 0 });

    const result = await refundOrder({
      orderNo: "NO20260908001",
      adminId: "admin-1",
      reason: "余额已清空",
      deductCredits: true,
    });

    expect(result.clawedBack).toBe(0);
    expect(chargeCredits).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({ clawedBack: 0, shortfall: 1000 }),
      })
    );
  });

  it("用户已被删除（查不到）：按余额 0 处理，不抛错", async () => {
    orderFindUnique.mockResolvedValue(paidOrder());
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.user.findUnique.mockResolvedValue(null);

    const result = await refundOrder({
      orderNo: "NO20260908001",
      adminId: "admin-1",
      reason: "用户注销",
      deductCredits: true,
    });

    expect(result.clawedBack).toBe(0);
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("deductCredits=false：只改状态不动积分", async () => {
    orderFindUnique.mockResolvedValue(paidOrder());
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    const result = await refundOrder({
      orderNo: "NO20260908001",
      adminId: "admin-1",
      reason: "赠送不收回",
      deductCredits: false,
    });

    expect(result.clawedBack).toBe(0);
    expect(chargeCredits).not.toHaveBeenCalled();
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({ deductCredits: false, shortfall: 0 }),
      })
    );
  });

  it("订单不存在：not_found，不开事务", async () => {
    orderFindUnique.mockResolvedValue(null);

    const result = await refundOrder({
      orderNo: "NOPE",
      adminId: "admin-1",
      reason: "x",
      deductCredits: true,
    });

    expect(result.status).toBe("not_found");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("已退款订单：already_refunded，不重复扣回", async () => {
    orderFindUnique.mockResolvedValue(makeOrder({ status: "REFUNDED" }));

    const result = await refundOrder({
      orderNo: "NO20260908001",
      adminId: "admin-1",
      reason: "x",
      deductCredits: true,
    });

    expect(result.status).toBe("already_refunded");
    expect(chargeCredits).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("PENDING 订单：invalid_state（没收过钱谈不上退款）", async () => {
    orderFindUnique.mockResolvedValue(makeOrder({ status: "PENDING" }));

    const result = await refundOrder({
      orderNo: "NO20260908001",
      adminId: "admin-1",
      reason: "x",
      deductCredits: true,
    });

    expect(result.status).toBe("invalid_state");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("并发退款抢占失败：事务回滚后返回 already_refunded 而非 500", async () => {
    orderFindUnique.mockResolvedValue(paidOrder());
    // 另一个请求先把 PAID 翻成了 REFUNDED
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    const result = await refundOrder({
      orderNo: "NO20260908001",
      adminId: "admin-1",
      reason: "并发",
      deductCredits: true,
    });

    expect(result.status).toBe("already_refunded");
    expect(chargeCredits).not.toHaveBeenCalled();
  });
});
