/**
 * AI 起草辅助路由的共享执行器（对应计划批次 1 · assist 路由族）
 *
 * 三条 assist 路由（worldview-draft / appearance-draft / prompt-suggest）都是
 * 「一次短文本 LLM 调用 → parseLooseJSON → Zod 校验 → 最多 2 次重试」的同一骨架，
 * 参照 drama-script-agent 的重试思路做轻量版：不进 agents/ 目录、不落库、同步返回。
 *
 * 统一在此收口，避免三条路由各自复制这段循环逻辑（DRY + 一致的容错行为）。
 */

import type { z } from "zod";
import { chatCompletion } from "@/services/ai";
import { parseLooseJSON } from "@/lib/json-repair";
import type { AIServiceConfig } from "@/types";

/** 单次 LLM 起草参数 */
export interface DraftLLMParams<T> {
  system: string;
  userPrompt: string;
  /** 校验 LLM 输出结构的 Zod schema */
  schema: z.ZodType<T>;
  /** 用户 LLM 配置（null/undefined 时走服务端环境兜底配置） */
  config?: AIServiceConfig | null;
  temperature?: number;
  maxTokens?: number;
  /** 含首次在内的最大尝试次数（默认 2） */
  maxAttempts?: number;
}

/**
 * 执行一次结构化起草：调用 LLM → 宽松解析 JSON → Zod 校验；失败按 maxAttempts 重试。
 *
 * @throws Error 当所有尝试均未通过校验时抛出（由路由 catch 转 500）
 */
export async function runStructuredDraft<T>(
  params: DraftLLMParams<T>
): Promise<T> {
  const {
    system,
    userPrompt,
    schema,
    config,
    temperature = 0.8,
    maxTokens = 1024,
    maxAttempts = 2,
  } = params;

  let lastError = "未知错误";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 重试时在 user prompt 尾部追加「上一轮为何失败」，引导模型修正格式
    const attemptPrompt =
      attempt === 1
        ? userPrompt
        : `${userPrompt}\n\n（上一次输出不符合要求：${lastError}。请严格只输出合法 JSON，不要任何多余内容。）`;

    try {
      const response = await chatCompletion(
        [
          { role: "system", content: system },
          { role: "user", content: attemptPrompt },
        ],
        {
          config: config || undefined,
          temperature,
          maxTokens,
        }
      );

      const parsed = parseLooseJSON(response);
      const result = schema.safeParse(parsed);

      if (result.success) {
        return result.data;
      }

      lastError = result.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`AI 起草失败（${maxAttempts} 次尝试均未通过）：${lastError}`);
}
