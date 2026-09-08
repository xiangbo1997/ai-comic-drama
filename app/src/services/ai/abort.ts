/**
 * 取消信号工具：把 facade 层的超时 abort 贯通到各 provider 的 fetch / 轮询。
 *
 * 背景：门面的 withTimeout 过去只 reject 外层 Promise，底层 socket 继续挂着 ——
 * 并发额度被提前释放、连接却仍占用上游资源。现在 withTimeout 持有
 * AbortController 并把 signal 逐层下传，本模块提供三件下传时必需的原语：
 *
 * 1. `TimeoutAbortError`：标记「因超时而中止」，与「上游真的报错」区分开，
 *    供 lib/retry 的 shouldRetry 短路（超时中止重试没有意义，只会拖长失败反馈）。
 * 2. `mergeSignals`：provider 自带 AbortController（flow2api / gpt-sovits）时，
 *    把自身超时信号与外部信号合并成一个。
 * 3. `throwIfAborted`：轮询型 provider（Fal / Runway）在两次请求之间检查信号，
 *    避免已被中止的任务继续空转到自身超时上限。
 */

/**
 * 因「门面层超时」而中止的错误。
 *
 * 单独立类型的原因：AbortError 无法区分「超时中止」与「上游主动断流」，
 * 而二者的重试语义相反 —— 超时中止重试必然再次超时（上游本来就卡死），
 * 应立即冒泡；瞬时断流才值得退避重试。isTimeoutAbortError 供重试层判定。
 */
export class TimeoutAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutAbortError";
  }
}

/** 判定错误是否为超时中止（供 lib/retry 的 shouldRetry 短路，不重试） */
export function isTimeoutAbortError(error: unknown): boolean {
  return error instanceof TimeoutAbortError;
}

/**
 * 判定错误是否为 fetch/流读取被中止（AbortError）。
 *
 * provider 内部把 AbortError 翻译成自己的中文超时文案前，需要先识别它；
 * DOMException 与普通 Error 两种载体都可能出现（undici / Node 版本差异）。
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * 合并多个中止信号：任一触发即中止。
 *
 * 用于 provider 自带超时 controller 的场景 —— 既要保留 provider 自身的
 * 上限（如 flow2api 30 分钟），又要响应门面层传下来的 signal。
 * undefined 会被忽略；全部为空时返回 undefined（调用方不下发 signal）。
 *
 * 实现用 AbortSignal.any（Node 20+ / CI 与生产均为 Node 22，见 ci.yml）。
 */
export function mergeSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

/**
 * 轮询循环中的中止检查：已中止则立刻抛错退出，不再进入下一轮。
 *
 * 队列型 provider（Fal / Runway）提交后每隔数秒拉一次状态，若不检查信号，
 * 门面超时后循环仍会空转到自身 10 分钟上限才结束。
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("请求已被中止");
    error.name = "AbortError";
    throw error;
  }
}
