/**
 * AI 服务层的类型化错误。
 *
 * 单独成文件（而非塞进 index.ts）以避免 providers/* → index.ts 的循环引用：
 * index.ts 已经 import providers（经 provider-factory），provider 再反向 import
 * index.ts 会成环。
 */

/**
 * LLM 输出被 maxTokens 截断。
 *
 * 背景：各家 API 在输出触顶时并不报错，而是正常 200 返回一段【残缺】文本
 * （OpenAI `finish_reason: "length"` / Claude `stop_reason: "max_tokens"` /
 * Gemini `finishReason: "MAX_TOKENS"`）。调用方拿到半截 JSON 后只会看到一个
 * 「JSON 解析失败」，据此重试同样的请求 → 必然再次截断，白烧 N 轮 token。
 *
 * 显式抛出本错误，让上层（如 ScriptParserAgent）能识别截断并采取【不同的】
 * 策略：提高 maxTokens 或要求模型缩短输出，而不是原样重试。
 */
export class TruncatedOutputError extends Error {
  readonly name = "TruncatedOutputError";
  /** provider 原始的结束原因（如 "length" / "max_tokens" / "MAX_TOKENS"） */
  readonly finishReason: string;
  /** 本次请求下发的 maxTokens（可用于上层翻倍重试） */
  readonly requestedMaxTokens?: number;
  /** 已产出的残缺文本（排障用，不供解析） */
  readonly partialContent: string;

  constructor(params: {
    finishReason: string;
    requestedMaxTokens?: number;
    partialContent: string;
  }) {
    super(
      `LLM 输出被截断（finish_reason=${params.finishReason}` +
        (params.requestedMaxTokens
          ? `, maxTokens=${params.requestedMaxTokens}`
          : "") +
        `）：结果不完整。请提高 maxTokens 或缩短要求的输出长度。`
    );
    this.finishReason = params.finishReason;
    this.requestedMaxTokens = params.requestedMaxTokens;
    this.partialContent = params.partialContent;
  }
}

/** 类型守卫：判断任意 error 是否为截断错误（跨模块边界安全） */
export function isTruncatedOutputError(
  err: unknown
): err is TruncatedOutputError {
  return err instanceof TruncatedOutputError;
}
