import { describe, it, expect } from "vitest";
import { pollUntilDone, type PollStep } from "@/services/ai/providers/poll";
import { isAbortError } from "@/services/ai/abort";

describe("pollUntilDone — 中止信号", () => {
  it("传入已中止的 signal → 一次上游请求都不发", async () => {
    const controller = new AbortController();
    controller.abort();

    let calls = 0;
    const step = async (): Promise<PollStep<string>> => {
      calls += 1;
      return { done: true, result: "should not reach" };
    };

    await expect(
      pollUntilDone(step, { signal: controller.signal })
    ).rejects.toThrow(/已被中止/);
    expect(calls).toBe(0);
  });

  it("轮询途中中止 → 立即退出，不再继续拉状态", async () => {
    const controller = new AbortController();

    let calls = 0;
    const step = async (): Promise<PollStep<string>> => {
      calls += 1;
      // 第 2 轮时模拟门面超时触发的中止
      if (calls === 2) controller.abort();
      return { pending: true };
    };

    await expect(
      pollUntilDone(step, {
        intervalMs: 10,
        timeoutMs: 10_000,
        signal: controller.signal,
      })
    ).rejects.toThrow(/已被中止/);

    // 中止发生在第 2 轮：不应再进入第 3 轮
    expect(calls).toBe(2);
  });

  it("中止时抛的是 AbortError（供上层重试层短路，不重试）", async () => {
    const controller = new AbortController();
    controller.abort();

    try {
      await pollUntilDone(async () => ({ pending: true }) as PollStep<string>, {
        signal: controller.signal,
      });
      expect.unreachable("应当抛出中止错误");
    } catch (err) {
      expect(isAbortError(err)).toBe(true);
    }
  });

  it("等待间隔期间中止 → 不必等满整个 interval", async () => {
    const controller = new AbortController();
    // interval 设很长；若 sleep 不可中断，本用例会超时失败
    setTimeout(() => controller.abort(), 20);

    const started = Date.now();
    await expect(
      pollUntilDone(async () => ({ pending: true }) as PollStep<string>, {
        intervalMs: 30_000,
        timeoutMs: 60_000,
        signal: controller.signal,
      })
    ).rejects.toThrow(/已被中止/);

    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("无 signal 时行为不变：正常完成", async () => {
    let calls = 0;
    const result = await pollUntilDone(
      async (): Promise<PollStep<string>> => {
        calls += 1;
        return calls < 2 ? { pending: true } : { done: true, result: "ok" };
      },
      { intervalMs: 1 }
    );

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });
});
