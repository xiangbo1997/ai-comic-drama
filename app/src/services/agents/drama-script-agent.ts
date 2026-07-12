/**
 * DramaScriptAgent — 世界观 → 结构化短剧脚本
 *
 * 对应创作者手动流程第 3 步。复用 ScriptParserAgent 的「Zod 校验 + 3 轮自修复 +
 * parseLooseJSON 容错」骨架，独立于 WorkflowEngine 使用。
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import {
  DRAMA_SCRIPT_SYSTEM,
  buildDramaScriptUserPrompt,
  buildDramaScriptRepairPrompt,
} from "@/lib/prompts/agent-prompts";
import { createLogger } from "@/lib/logger";
import { parseLooseJSON } from "@/lib/json-repair";
import { resolveLLMParams } from "./llm-params";
import type { Agent, AgentResult, WorkflowContext } from "./types";
import type { DramaScriptInput, DramaScriptArtifact } from "@/types/drama";
import { HOOK_TYPES } from "@/types/series-bible";

const log = createLogger("agent:drama-script");

const DramaSceneSchema = z.object({
  index: z.number(),
  title: z.string().min(1),
  description: z.string().min(10),
  dialogue: z.string().nullable(),
  narration: z.string().nullable(),
  emotion: z.string(),
  durationSec: z.number().min(1).max(60),
});

const DramaScriptSchema = z.object({
  filmTitle: z.string().min(1),
  genre: z.string().min(1),
  durationSec: z.number().min(10).max(600),
  aspectRatio: z.string().min(1),
  style: z.string().min(1),
  protagonist: z.string(),
  worldview: z.string().min(1),
  logline: z.string().min(1),
  // 本集结尾钩子类型（爆款方法论）；与 series-bible HOOK_TYPES 对齐，供史官读取。
  // 可选 + 非法回落 undefined：LLM 漏填 / 写错不阻断整脚本校验。
  hookType: z.enum(HOOK_TYPES).optional().catch(undefined),
  scenes: z.array(DramaSceneSchema).min(1),
});

const MAX_ATTEMPTS = 3;

function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

export class DramaScriptAgent implements Agent<
  DramaScriptInput,
  DramaScriptArtifact
> {
  readonly name = "drama_script";

  async run(
    input: DramaScriptInput,
    ctx: WorkflowContext
  ): Promise<AgentResult<DramaScriptArtifact>> {
    let totalTokens = 0;
    let lastRawOutput = "";
    let lastZodError: z.ZodError | null = null;
    let lastNonZodError: string | null = null;

    const userPrompt = buildDramaScriptUserPrompt(input);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const messages =
        attempt === 1
          ? [
              { role: "system" as const, content: DRAMA_SCRIPT_SYSTEM },
              { role: "user" as const, content: userPrompt },
            ]
          : [
              { role: "system" as const, content: DRAMA_SCRIPT_SYSTEM },
              { role: "user" as const, content: userPrompt },
              {
                role: "assistant" as const,
                content: lastRawOutput.slice(0, 3000),
              },
              {
                role: "user" as const,
                content: buildDramaScriptRepairPrompt(
                  lastRawOutput,
                  lastZodError
                    ? formatZodErrors(lastZodError)
                    : (lastNonZodError ?? "JSON parse failed")
                ),
              },
            ];

      try {
        const llmParams = resolveLLMParams(ctx.config, {
          defaultTemperature: 0.7,
          defaultMaxTokens: 8192,
        });
        const response = await chatCompletion(messages, {
          temperature: llmParams.temperature,
          maxTokens: llmParams.maxTokens,
          config: ctx.config.llm,
        });

        lastRawOutput = response;
        totalTokens += Math.ceil((userPrompt.length + response.length) / 4);

        const parsed = parseLooseJSON(response);
        const result = DramaScriptSchema.safeParse(parsed);

        if (result.success) {
          log.info(`Drama script generated on attempt ${attempt}`);
          return {
            success: true,
            data: result.data as DramaScriptArtifact,
            reasoning: `成功生成短剧脚本《${result.data.filmTitle}》，共 ${result.data.scenes.length} 个场景`,
            attempts: attempt,
            tokensUsed: totalTokens,
          };
        }

        lastZodError = result.error;
        lastNonZodError = null;
        log.warn(
          `Attempt ${attempt} validation failed: ${formatZodErrors(result.error)}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Attempt ${attempt} failed: ${message}`);
        lastRawOutput = message;
        lastNonZodError = message;
        lastZodError = null;
      }
    }

    log.error("Drama script generation failed after all attempts");

    let failureReason: string;
    if (lastZodError) {
      failureReason = `LLM 输出未通过结构校验：${formatZodErrors(lastZodError)}`;
    } else if (lastNonZodError) {
      failureReason = lastNonZodError;
    } else {
      failureReason = "未知错误";
    }

    return {
      success: false,
      error: failureReason,
      attempts: MAX_ATTEMPTS,
      tokensUsed: totalTokens,
    };
  }
}
