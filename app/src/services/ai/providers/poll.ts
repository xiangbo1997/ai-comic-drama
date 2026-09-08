/**
 * 通用异步任务轮询器
 *
 * 设计动机（借鉴 open-storyboard-canvas 的 pollAsyncTaskResult 思路，按本项目需求精简）：
 * - 队列型 provider（Fal.ai 等）提交任务后需轮询状态直到完成，逻辑高度重复。
 * - 原各 provider 用 `while(true)` 死循环轮询，无超时上限 → 上游卡死会无限挂起。
 *
 * 本工具统一三件事：
 * 1. 轮询间隔 + 超时上限（防止无限挂起）；
 * 2. 完成/失败/进行中的状态判定交给调用方（纯函数 step）；
 * 3. 超时抛出明确错误。
 */

import { throwIfAborted } from "../abort";

/** 单次轮询的结果：完成（带结果）/ 失败（带原因）/ 仍在进行 */
export type PollStep<T> =
  | { done: true; result: T }
  | { failed: true; reason: string }
  | { pending: true };

export interface PollOptions {
  /** 轮询间隔（毫秒），默认 3000 */
  intervalMs?: number;
  /** 超时上限（毫秒），默认 300000（5 分钟），超时抛错 */
  timeoutMs?: number;
  /** 超时错误信息前缀，便于定位是哪个 provider */
  timeoutLabel?: string;
  /**
   * 中止信号（门面 withTimeout 下传）。每轮请求前与等待后各检查一次：
   * 门面超时后循环若不退出，会一直空转到本轮询自身的超时上限才结束。
   */
  signal?: AbortSignal;
}

/**
 * 可中断的等待：中止信号触发时立刻 reject，不必等满整个轮询间隔。
 * 无 signal 时行为等同普通 sleep。
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      const error = new Error("请求已被中止");
      error.name = "AbortError";
      reject(error);
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 轮询直到 step 返回 done 或 failed，或超时。
 *
 * @param step 单次轮询逻辑：自行发请求并把响应归一化为 PollStep。
 * @returns 完成时的结果 T。
 * @throws step 返回 failed 时抛 Error(reason)；超时抛 Error(timeout)。
 */
export async function pollUntilDone<T>(
  step: () => Promise<PollStep<T>>,
  options: PollOptions = {}
): Promise<T> {
  const {
    intervalMs = 3000,
    timeoutMs = 300_000,
    timeoutLabel = "异步任务",
    signal,
  } = options;

  const deadline = Date.now() + timeoutMs;

  while (true) {
    // 每轮请求前检查：门面已超时/上层已取消则立即退出，不再打上游
    throwIfAborted(signal);

    const outcome = await step();

    if ("done" in outcome) {
      return outcome.result;
    }
    if ("failed" in outcome) {
      throw new Error(outcome.reason);
    }

    if (Date.now() + intervalMs >= deadline) {
      throw new Error(
        `${timeoutLabel}轮询超时（已等待 ${Math.round(timeoutMs / 1000)}s 未完成）`
      );
    }

    await sleep(intervalMs, signal);
  }
}
