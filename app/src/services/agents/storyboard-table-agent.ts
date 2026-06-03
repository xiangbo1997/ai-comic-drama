/**
 * StoryboardTableAgent — 结构化脚本 → 九宫格分镜表（恰好 9 格）
 *
 * 与 storyboard-agent.ts（7 步管线的分镜补全）区分：本 Agent 产出创作态的
 * 九宫格分镜表文档。复用 DramaScriptAgent 同款 Zod + 自修复骨架。
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import {
  STORYBOARD_TABLE_SYSTEM,
  buildStoryboardTableUserPrompt,
  buildStoryboardTableRepairPrompt,
} from "@/lib/prompts/agent-prompts";
import { createLogger } from "@/lib/logger";
import { parseLooseJSON } from "@/lib/json-repair";
import { resolveLLMParams } from "./llm-params";
import type { Agent, AgentResult, WorkflowContext } from "./types";
import type {
  DramaScriptArtifact,
  StoryboardTableArtifact,
} from "@/types/drama";

const log = createLogger("agent:storyboard-table");

const CellSchema = z.object({
  index: z.number().min(1).max(9),
  sceneTitle: z.string().min(1),
  shot: z.string().min(1),
  dialogue: z.string().nullable(),
  closeup: z.string().min(1),
  transition: z.string().min(1),
});

// 强约束：cells 数组长度必须恰好为 9
const StoryboardTableSchema = z.object({
  cells: z.array(CellSchema).length(9),
});

const MAX_ATTEMPTS = 3;

function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

export class StoryboardTableAgent implements Agent<
  DramaScriptArtifact,
  StoryboardTableArtifact
> {
  readonly name = "storyboard_table";

  async run(
    script: DramaScriptArtifact,
    ctx: WorkflowContext
  ): Promise<AgentResult<StoryboardTableArtifact>> {
    let totalTokens = 0;
    let lastRawOutput = "";
    let lastZodError: z.ZodError | null = null;
    let lastNonZodError: string | null = null;

    const userPrompt = buildStoryboardTableUserPrompt(script);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const messages =
        attempt === 1
          ? [
              { role: "system" as const, content: STORYBOARD_TABLE_SYSTEM },
              { role: "user" as const, content: userPrompt },
            ]
          : [
              { role: "system" as const, content: STORYBOARD_TABLE_SYSTEM },
              { role: "user" as const, content: userPrompt },
              {
                role: "assistant" as const,
                content: lastRawOutput.slice(0, 3000),
              },
              {
                role: "user" as const,
                content: buildStoryboardTableRepairPrompt(
                  lastRawOutput,
                  lastZodError
                    ? formatZodErrors(lastZodError)
                    : (lastNonZodError ?? "JSON parse failed")
                ),
              },
            ];

      try {
        const llmParams = resolveLLMParams(ctx.config, {
          defaultTemperature: 0.6,
          defaultMaxTokens: 4096,
        });
        const response = await chatCompletion(messages, {
          temperature: llmParams.temperature,
          maxTokens: llmParams.maxTokens,
          config: ctx.config.llm,
        });

        lastRawOutput = response;
        totalTokens += Math.ceil((userPrompt.length + response.length) / 4);

        const parsed = parseLooseJSON(response);
        const result = StoryboardTableSchema.safeParse(parsed);

        if (result.success) {
          log.info(`Storyboard table generated on attempt ${attempt}`);
          return {
            success: true,
            data: result.data as StoryboardTableArtifact,
            reasoning: `成功生成九宫格分镜表（9 格）`,
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

    log.error("Storyboard table generation failed after all attempts");

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
