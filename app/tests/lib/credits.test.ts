/**
 * 积分服务单测（资金路径）
 *
 * 手搓 prisma mock：只实现 credits.ts 真正调用的四个方法
 * （$transaction / tx.user.findUnique / tx.user.update / tx.creditTransaction.create），
 * 断言「余额校验 → 扣减 → 流水（含 balanceAfter 快照）」的顺序与内容。
 *
 * 重点覆盖资金安全不变量：
 *  - 余额不足必须一条流水都不写（不能先扣后校验）
 *  - 每条流水的 balanceAfter 取自 update 的返回值，而非本地推算
 *  - 退款幂等靠 DB 唯一约束（P2002）兜底，其他错误必须继续上抛
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// ── 手搓 prisma mock（tests/ 下暂无公共 prisma mock helper，就近定义）──
type MockTx = {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  creditTransaction: { create: ReturnType<typeof vi.fn> };
};

const tx: MockTx = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  creditTransaction: { create: vi.fn() },
};

// $transaction 直接把 mock tx 喂给回调；抛错则原样冒泡（模拟事务回滚后重抛）
const transactionMock = vi.fn(
  async (fn: (client: MockTx) => Promise<unknown>) => fn(tx)
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (fn: (client: MockTx) => Promise<unknown>) =>
      transactionMock(fn),
  },
}));

import {
  chargeCredits,
  grantCredits,
  refundCredits,
  InsufficientCreditsError,
} from "@/lib/credits";

/** credits.ts 只用到 TransactionClient 的三个方法，用受控断言把 mock 适配上去 */
const asTx = (m: MockTx) => m as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.clearAllMocks();
  tx.user.findUnique.mockReset();
  tx.user.update.mockReset();
  tx.creditTransaction.create.mockReset();
});

describe("chargeCredits — 扣费", () => {
  it("余额充足：扣减 + 写流水，balanceAfter 取 update 返回值", async () => {
    tx.user.findUnique.mockResolvedValue({ credits: 100 });
    tx.user.update.mockResolvedValue({ credits: 70 });

    await chargeCredits(asTx(tx), {
      userId: "u1",
      amount: 30,
      type: "GENERATE_IMAGE",
      source: "scene:s1",
      sourceId: "task-1",
      note: "出图",
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { credits: { decrement: 30 } },
      select: { credits: true },
    });
    expect(tx.creditTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        delta: -30,
        balanceAfter: 70,
        type: "GENERATE_IMAGE",
        source: "scene:s1",
        sourceId: "task-1",
        note: "出图",
      },
    });
  });

  it("缺省 sourceId / note 落库为 null（不写 undefined）", async () => {
    tx.user.findUnique.mockResolvedValue({ credits: 10 });
    tx.user.update.mockResolvedValue({ credits: 5 });

    await chargeCredits(asTx(tx), {
      userId: "u1",
      amount: 5,
      type: "GENERATE_TTS",
      source: "tts",
    });

    expect(tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceId: null, note: null }),
    });
  });

  it("余额恰好等于扣减额时允许扣到 0", async () => {
    tx.user.findUnique.mockResolvedValue({ credits: 30 });
    tx.user.update.mockResolvedValue({ credits: 0 });

    await expect(
      chargeCredits(asTx(tx), {
        userId: "u1",
        amount: 30,
        type: "GENERATE_VIDEO",
        source: "v",
      })
    ).resolves.toBeUndefined();
    expect(tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ balanceAfter: 0, delta: -30 }),
    });
  });

  it("余额不足：抛 InsufficientCreditsError 且不写任何数据", async () => {
    tx.user.findUnique.mockResolvedValue({ credits: 5 });

    const promise = chargeCredits(asTx(tx), {
      userId: "u1",
      amount: 30,
      type: "GENERATE_IMAGE",
      source: "scene:s1",
    });

    await expect(promise).rejects.toBeInstanceOf(InsufficientCreditsError);
    await promise.catch((err: unknown) => {
      const e = err as InsufficientCreditsError;
      expect(e.available).toBe(5);
      expect(e.required).toBe(30);
      expect(e.name).toBe("InsufficientCreditsError");
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("用户不存在：抛错且不写任何数据", async () => {
    tx.user.findUnique.mockResolvedValue(null);

    await expect(
      chargeCredits(asTx(tx), {
        userId: "ghost",
        amount: 1,
        type: "GENERATE_SCRIPT",
        source: "s",
      })
    ).rejects.toThrow(/用户不存在/);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("金额非正整数：先于任何 DB 调用被拒", async () => {
    for (const amount of [0, -5, 1.5, NaN, Infinity]) {
      await expect(
        chargeCredits(asTx(tx), {
          userId: "u1",
          amount,
          type: "GENERATE_IMAGE",
          source: "s",
        })
      ).rejects.toThrow(/正整数/);
    }
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.creditTransaction.create).not.toHaveBeenCalled();
  });
});

describe("grantCredits — 发放", () => {
  it("增加余额并写正向流水", async () => {
    tx.user.update.mockResolvedValue({ credits: 1050 });

    await grantCredits(asTx(tx), {
      userId: "u1",
      amount: 1000,
      type: "PAYMENT",
      source: "order",
      sourceId: "order-9",
      note: "充值",
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { credits: { increment: 1000 } },
      select: { credits: true },
    });
    expect(tx.creditTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        delta: 1000,
        balanceAfter: 1050,
        type: "PAYMENT",
        source: "order",
        sourceId: "order-9",
        note: "充值",
      },
    });
  });

  it("金额非正整数被拒且不写 DB", async () => {
    await expect(
      grantCredits(asTx(tx), {
        userId: "u1",
        amount: 0,
        type: "CHECKIN",
        source: "checkin",
      })
    ).rejects.toThrow(/正整数/);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe("refundCredits — 退款（自带事务 + 幂等）", () => {
  /** 造一个带指定 code 的 Prisma 已知请求错误 */
  const knownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError("mock", {
      code,
      clientVersion: "test",
    });

  it("正常退款：increment + 写 REFUND 流水", async () => {
    tx.user.update.mockResolvedValue({ credits: 130 });

    await refundCredits({
      userId: "u1",
      amount: 30,
      source: "scene:s1",
      sourceId: "task-1",
      note: "生成失败退款",
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { credits: { increment: 30 } },
      select: { credits: true },
    });
    expect(tx.creditTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        delta: 30,
        balanceAfter: 130,
        type: "REFUND",
        source: "scene:s1",
        sourceId: "task-1",
        note: "生成失败退款",
      },
    });
  });

  it("重复退款（P2002 唯一约束冲突）被吞掉，视为幂等成功", async () => {
    tx.user.update.mockResolvedValue({ credits: 130 });
    tx.creditTransaction.create.mockRejectedValue(knownError("P2002"));

    await expect(
      refundCredits({
        userId: "u1",
        amount: 30,
        source: "scene:s1",
        sourceId: "task-1",
      })
    ).resolves.toBeUndefined();
  });

  it("无 sourceId 时 P2002 不被吞（无法去重，必须上抛）", async () => {
    tx.user.update.mockResolvedValue({ credits: 130 });
    tx.creditTransaction.create.mockRejectedValue(knownError("P2002"));

    await expect(
      refundCredits({ userId: "u1", amount: 30, source: "scene:s1" })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("其他 Prisma 错误码（P2025）继续上抛", async () => {
    tx.user.update.mockRejectedValue(knownError("P2025"));

    await expect(
      refundCredits({
        userId: "u1",
        amount: 30,
        source: "scene:s1",
        sourceId: "task-1",
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("非 Prisma 错误（如连接断开）继续上抛", async () => {
    tx.user.update.mockRejectedValue(new Error("connection lost"));

    await expect(
      refundCredits({
        userId: "u1",
        amount: 30,
        source: "scene:s1",
        sourceId: "task-1",
      })
    ).rejects.toThrow(/connection lost/);
  });

  it("金额非正整数被拒且不开事务", async () => {
    await expect(
      refundCredits({ userId: "u1", amount: -1, source: "s" })
    ).rejects.toThrow(/正整数/);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
