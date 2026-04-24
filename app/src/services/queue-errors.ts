/**
 * 队列错误分级（Stage 2.3）
 *
 * BullMQ 只根据"处理器是否 throw"决定重试——不会根据错误类型智能判断。
 * 这里把错误归类为三级：
 *   - network：网络/超时/5xx → 应该重试（throw）
 *   - provider：provider 配额/鉴权/4xx → 不应该重试（返回 fail，结束）
 *   - validation：输入/内容不合规/积分不足 → 不应该重试
 *
 * 使用：
 *   const category = categorizeError(err);
 *   if (category.retryable) throw err;  // BullMQ 会重试
 *   return { success: false, error: err.message };  // 终止不重试
 */

export type ErrorCategory = "network" | "provider" | "validation";

export interface CategorizedError {
  category: ErrorCategory;
  retryable: boolean;
  message: string;
}

const NETWORK_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
  /network/i,
  /timeout/i,
  /socket hang up/i,
  /\b5\d\d\b/, // 5xx
];

const PROVIDER_PATTERNS = [
  /\b401\b/,
  /\b403\b/,
  /unauthori[sz]ed/i,
  /invalid api key/i,
  /insufficient.*(credit|balance|quota)/i,
  /rate limit/i,
  /\b429\b/,
];

const VALIDATION_PATTERNS = [
  /content.*(safety|policy|不符合)/i,
  /\b400\b/,
  /\b404\b/,
  /not found/i,
  /missing (field|parameter)/i,
];

export function categorizeError(err: unknown): CategorizedError {
  const message = err instanceof Error ? err.message : String(err);

  if (NETWORK_PATTERNS.some((p) => p.test(message))) {
    return { category: "network", retryable: true, message };
  }
  if (PROVIDER_PATTERNS.some((p) => p.test(message))) {
    return { category: "provider", retryable: false, message };
  }
  if (VALIDATION_PATTERNS.some((p) => p.test(message))) {
    return { category: "validation", retryable: false, message };
  }
  // 默认：未知错误视为可重试 network 类（保守策略，避免因分类失败丢失任务）
  return { category: "network", retryable: true, message };
}

/**
 * 便捷：把 worker 的"捕获 → 判断 → throw/return"包成 helper。
 * 用法：
 *   return handleWorkerError(err, async () => {
 *     // 失败时的清理逻辑（更新 DB 状态等）
 *   });
 */
export async function handleWorkerError(
  err: unknown,
  cleanup: (categorized: CategorizedError) => Promise<void>
): Promise<{ success: false; error: string }> {
  const categorized = categorizeError(err);
  await cleanup(categorized);

  if (categorized.retryable) {
    // 抛出让 BullMQ 走 backoff 重试
    throw err instanceof Error ? err : new Error(categorized.message);
  }

  // 不可重试：返回失败结果，BullMQ 会标记为 failed（不再重试）
  return { success: false, error: categorized.message };
}
