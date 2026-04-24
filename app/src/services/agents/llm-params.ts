/**
 * 统一的 LLM 调用参数解析器（Stage 1.10）
 *
 * 为什么集中：原先 script-parser / character-bible / storyboard 各自硬编码 temperature / maxTokens，
 * 导致 1) 用户无法调优；2) 改一个遗漏一个。现在所有 Agent 都通过 `resolveLLMParams` 取参数，
 * 单点决定"用户配置 > agent 默认"的优先级。
 *
 * 使用：
 * ```ts
 * const { temperature, maxTokens } = resolveLLMParams(ctx.config, {
 *   defaultTemperature: 0.4,
 *   defaultMaxTokens: 4096,
 * });
 * ```
 */

import type { WorkflowConfig } from "./types";

export interface LLMDefaults {
  defaultTemperature: number;
  defaultMaxTokens: number;
}

export interface ResolvedLLMParams {
  temperature: number;
  maxTokens: number;
  topP?: number;
}

/**
 * 按用户 generationParams 覆盖默认值；topP 仅在用户明确提供时传递。
 */
export function resolveLLMParams(
  config: WorkflowConfig,
  defaults: LLMDefaults
): ResolvedLLMParams {
  const gp = config.generationParams ?? {};
  const temperature =
    typeof gp.temperature === "number"
      ? clamp(gp.temperature, 0, 1.5)
      : defaults.defaultTemperature;
  const topP = typeof gp.topP === "number" ? clamp(gp.topP, 0, 1) : undefined;
  return {
    temperature,
    maxTokens: defaults.defaultMaxTokens,
    topP,
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
