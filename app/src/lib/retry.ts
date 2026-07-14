/**
 * 网络层重试工具（借鉴 yt-dlp 的 retry + 指数退避 + Retry-After 感知）
 *
 * 设计边界（重要）：
 * - 只用于「网络/网关瞬时错误」重试：429 限流、502/503/504/525 网关抖动、TCP 断流。
 * - 绝不用于「内容质量重试」（人脸校验、Zod 自修复）——那些走 image-orchestrator /
 *   closed-loop，与本工具正交。二者叠乘会放大扣费/配额消耗。
 * - 认证失败(401/403)、参数错误(400/404/422) 一律不重试——重试也不会好，只会拖慢失败反馈。
 */

/** 统一 sleep（此前散落 5+ 处各写一份，收口到这里） */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 可重试的 HTTP 状态码：限流 + 常见网关瞬时故障。
 *
 * 刻意**不含 500**：国内中转站普遍拿 500 兜内容安全/prompt 拒绝等确定性失败，
 * 重试也不会好——只会白白多付 3× 延迟；对图像/视频还是 3× 上游配额浪费。
 * 保留 502/503/504（网关抖动）与 Cloudflare 522/524/525（中转站常见）。
 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504, 522, 524, 525]);

/**
 * 判断 HTTP 状态码是否值得重试。
 * 429=限流，5xx/52x=网关瞬时故障（Cloudflare 522/524/525 常见于中转站）。
 */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/**
 * 判断错误是否为对端 TCP 断流 / 网络抖动；这类错误重试通常能成功。
 * 从 openai-compatible.ts 的 isTransientNetworkError 提炼收口，供全项目复用。
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes("terminated")) return true;
  const code = (err as { code?: string }).code;
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  if (
    cause?.code === "ECONNRESET" ||
    cause?.code === "ETIMEDOUT" ||
    cause?.code === "UND_ERR_SOCKET"
  ) {
    return true;
  }
  if (cause?.message?.includes("ECONNRESET")) return true;
  return false;
}

/**
 * 判断错误是否为**连接建立阶段**失败（DNS 解析失败 / 连接被拒 / 连接前超时）。
 *
 * 与 isTransientNetworkError 的关键区别：只认「还没建立连接、请求肯定没到后端」
 * 的错误码，**排除** ECONNRESET/EPIPE 这类「连接已建立、可能已在传输中」的断流。
 * 用于非幂等的生成提交请求（submit 模式）：连接前失败重试是安全的（后端未启动生成），
 * 而中途断流重试会触发整段重新生成 → 双倍上游配额消耗。
 *
 * undici 无法可靠区分「响应字节前」与「响应字节后」的 socket reset，
 * 故此处对无法确证发生在连接前的 reset 一律不重试（宁可失败也不重复扣配额）。
 */
export function isConnectionPhaseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const connectCodes = new Set([
    "ECONNREFUSED", // 连接被拒（后端未监听）
    "ENOTFOUND", // DNS 解析失败
    "EAI_AGAIN", // DNS 临时失败
    "UND_ERR_CONNECT_TIMEOUT", // undici 连接握手超时（连接前）
  ]);
  const code = (err as { code?: string }).code;
  if (code && connectCodes.has(code)) return true;
  const cause = (err as { cause?: { code?: string } }).cause;
  if (cause?.code && connectCodes.has(cause.code)) return true;
  return false;
}

/**
 * 解析 Retry-After 响应头（借鉴 yt-dlp：限流时优先听上游的，而非盲目退避）。
 * 支持「秒数」与「HTTP-date」两种格式，返回毫秒；无法解析返回 null。
 */
export function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();

  // 形态一：纯秒数
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }

  // 形态二：HTTP-date（如 "Wed, 21 Oct 2026 07:28:00 GMT"）
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

/** 一次重试失败携带的上下文，供 onRetry 观测/日志 */
export interface RetryContext {
  /** 第几次重试（从 1 开始） */
  attempt: number;
  /** 本次触发重试的错误 */
  error: unknown;
  /** 实际等待的毫秒数 */
  delayMs: number;
}

export interface RetryOptions {
  /** 最大重试次数（不含首次尝试）。默认 2（即最多请求 3 次） */
  maxRetries?: number;
  /** 指数退避基数毫秒，第 n 次退避 ≈ baseDelayMs * 2^(n-1)。默认 1000 */
  baseDelayMs?: number;
  /** 退避上限毫秒，防止 HTTP-date 型 Retry-After 把等待拉到离谱。默认 20000 */
  maxDelayMs?: number;
  /**
   * 自定义「是否重试」判定。返回 true 才重试；返回 { delayMs } 可覆盖等待时长
   * （用于把上游 Retry-After 透传进来）。默认判定：TCP 断流。
   */
  shouldRetry?: (error: unknown) => boolean | { delayMs: number };
  /** 每次重试前的回调（打日志用），不影响控制流 */
  onRetry?: (ctx: RetryContext) => void;
}

/** 指数退避 + 满抖动（full jitter），打散并发请求的「同步重试」惊群 */
function computeBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exp = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  // full jitter：在 [0, exp] 区间随机，避免多请求退避序列完全对齐后再次撞墙
  return Math.round(Math.random() * exp);
}

/**
 * 以指数退避重试一个异步操作。
 *
 * 用法：
 *   await withRetry(() => safeFetch(url, init), {
 *     shouldRetry: (e) => e instanceof RetryableHttpError
 *       ? { delayMs: e.retryAfterMs ?? 0 } : isTransientNetworkError(e),
 *   })
 *
 * 若 shouldRetry 返回带有效 delayMs（>=0 的有限值）的对象，则用它替代指数退避
 * （尊重上游 Retry-After，含 `Retry-After: 0` → 立即重试）；delayMs 为负/NaN
 * 等无效值时回退到指数退避 + 抖动。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 2,
    baseDelayMs = 1000,
    maxDelayMs = 20_000,
    shouldRetry = isTransientNetworkError,
    onRetry,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 已到最大次数，不再重试，直接冒泡
      if (attempt >= maxRetries) break;

      const decision = shouldRetry(error);
      if (!decision) break;

      // 上游给了明确等待时长就听它的（并夹在 maxDelayMs 内），否则指数退避。
      // delayMs === 0（上游 Retry-After: 0，要求立即重试）也是有效覆盖，须尊重；
      // 仅当为负/NaN 等无效值时才回退到指数退避。
      const override =
        typeof decision === "object" &&
        Number.isFinite(decision.delayMs) &&
        decision.delayMs >= 0
          ? Math.min(decision.delayMs, maxDelayMs)
          : null;
      const delayMs =
        override ?? computeBackoff(attempt + 1, baseDelayMs, maxDelayMs);

      onRetry?.({ attempt: attempt + 1, error, delayMs });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
