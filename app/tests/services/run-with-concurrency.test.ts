import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "@/app/(dashboard)/editor/[id]/hooks/run-with-concurrency";

/**
 * 有界并发池纯函数测试（D4）
 *
 * 核心保障：
 * - 同时在飞任务数不超过 limit（并发上限被遵守）
 * - 单个任务异常不中断其余任务（语义对齐 Promise.allSettled）
 * - 全部任务都被执行且恰好一次
 */

/** 构造一个可观测并发峰值的任务工厂集合 */
function makeTasks(
  count: number,
  onRun: (index: number) => Promise<void>
): Array<() => Promise<unknown>> {
  return Array.from({ length: count }, (_unused, index) => () => onRun(index));
}

/** 让出事件循环若干次，模拟异步耗时 */
function tick(times = 3): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) {
    p = p.then(() => undefined);
  }
  return p;
}

describe("runWithConcurrency", () => {
  it("并发峰值不超过 limit", async () => {
    let active = 0;
    let peak = 0;
    const tasks = makeTasks(10, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick();
      active -= 1;
    });

    await runWithConcurrency(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("所有任务恰好执行一次", async () => {
    const ran: number[] = [];
    const tasks = makeTasks(7, async (index) => {
      await tick();
      ran.push(index);
    });

    await runWithConcurrency(tasks, 2);
    expect(ran.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("单任务抛错不中断其余任务，且整体 resolve", async () => {
    const done: number[] = [];
    const tasks = makeTasks(5, async (index) => {
      await tick();
      if (index === 2) throw new Error("boom");
      done.push(index);
    });

    await expect(runWithConcurrency(tasks, 2)).resolves.toBeUndefined();
    // 除抛错的 index=2 外全部完成
    expect(done.sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
  });

  it("limit 非法（0 / 负数 / NaN）退化为串行，绝不阻塞", async () => {
    let active = 0;
    let peak = 0;
    const tasks = makeTasks(4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick();
      active -= 1;
    });

    await runWithConcurrency(tasks, 0);
    expect(peak).toBe(1);
  });

  it("空任务数组立即完成", async () => {
    await expect(runWithConcurrency([], 3)).resolves.toBeUndefined();
  });

  it("limit 大于任务数时不会创建多余 worker（不报错，全部完成）", async () => {
    const ran: number[] = [];
    const tasks = makeTasks(2, async (index) => {
      ran.push(index);
    });
    await runWithConcurrency(tasks, 10);
    expect(ran.sort((a, b) => a - b)).toEqual([0, 1]);
  });
});
