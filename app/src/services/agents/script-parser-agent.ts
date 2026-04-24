/**
 * ScriptParserAgent — 多轮剧本解析
 * 替代原 script.ts 的单次调用，增加 Zod 验证 + 自修复循环
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import {
  SCRIPT_PARSER_SYSTEM,
  buildScriptParserUserPrompt,
  buildScriptParserRepairPrompt,
} from "@/lib/prompts/agent-prompts";
import { createLogger } from "@/lib/logger";
import { resolveLLMParams } from "./llm-params";
import type {
  Agent,
  AgentResult,
  ScriptParserInput,
  ScriptArtifact,
  WorkflowContext,
} from "./types";

const log = createLogger("agent:script-parser");

// Zod schema 验证 LLM 输出
// Stage 1.8：cameraAngle / lighting / composition / colorPalette 作为可选字段，
// 老 LLM 输出（不含这些字段）仍能通过校验，新字段在 SceneScript 类型里透传。
const SceneScriptSchema = z.object({
  id: z.number(),
  shotType: z.string(),
  description: z.string().min(10),
  characters: z.array(z.string()),
  dialogue: z.string().nullable(),
  narration: z.string().nullable(),
  emotion: z.string(),
  duration: z.number().min(1).max(30),
  cameraAngle: z.string().optional(),
  lighting: z.string().optional(),
  composition: z.string().optional(),
  colorPalette: z.string().optional(),
});

const ScriptArtifactSchema = z.object({
  title: z.string().min(1),
  scenes: z.array(SceneScriptSchema).min(1),
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(5),
      })
    )
    .min(1),
});

const MAX_ATTEMPTS = 3;

/** 从 LLM 响应中提取 JSON */
function extractJSON(text: string): unknown {
  // 先尝试匹配 ```json 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim());
  }
  // 再尝试匹配裸 JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No JSON found in response");
}

/** 格式化 Zod 错误为可读字符串 */
function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

export class ScriptParserAgent implements Agent<
  ScriptParserInput,
  ScriptArtifact
> {
  readonly name = "script_parser";

  async run(
    input: ScriptParserInput,
    ctx: WorkflowContext
  ): Promise<AgentResult<ScriptArtifact>> {
    let totalTokens = 0;
    let lastRawOutput = "";
    let lastError: z.ZodError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      ctx.emit({
        type: attempt === 1 ? "step:started" : "agent:reflection",
        workflowRunId: ctx.workflowRunId,
        step: "parse_script",
        data: {
          attempt,
          message:
            attempt === 1
              ? "正在解析剧本文本..."
              : `解析结果格式有误，正在自动修复（第 ${attempt} 次）...`,
        },
        timestamp: new Date(),
      });

      const messages =
        attempt === 1
          ? [
              { role: "system" as const, content: SCRIPT_PARSER_SYSTEM },
              {
                role: "user" as const,
                content: buildScriptParserUserPrompt(input.text),
              },
            ]
          : [
              { role: "system" as const, content: SCRIPT_PARSER_SYSTEM },
              {
                role: "user" as const,
                content: buildScriptParserUserPrompt(input.text),
              },
              {
                role: "assistant" as const,
                content: lastRawOutput.slice(0, 3000),
              },
              {
                role: "user" as const,
                content: buildScriptParserRepairPrompt(
                  lastRawOutput,
                  lastError ? formatZodErrors(lastError) : "JSON parse failed"
                ),
              },
            ];

      try {
        const llmParams = resolveLLMParams(ctx.config, {
          defaultTemperature: 0.3,
          defaultMaxTokens: 8192,
        });
        const response = await chatCompletion(messages, {
          temperature: llmParams.temperature,
          maxTokens: llmParams.maxTokens,
          config: ctx.config.llm,
        });

        lastRawOutput = response;
        // 粗略估算 token（实际应从 provider 获取）
        totalTokens += Math.ceil((input.text.length + response.length) / 4);

        const parsed = extractJSON(response);
        const result = ScriptArtifactSchema.safeParse(parsed);

        if (result.success) {
          log.info(`Script parsed successfully on attempt ${attempt}`);
          return {
            success: true,
            data: result.data as ScriptArtifact,
            reasoning: `成功解析剧本，提取了 ${result.data.scenes.length} 个分镜和 ${result.data.characters.length} 个角色`,
            attempts: attempt,
            tokensUsed: totalTokens,
          };
        }

        lastError = result.error;
        log.warn(
          `Attempt ${attempt} validation failed: ${formatZodErrors(result.error)}`
        );
      } catch (err) {
        log.warn(
          `Attempt ${attempt} failed: ${err instanceof Error ? err.message : "Unknown"}`
        );
        lastRawOutput = String(err);
      }
    }

    log.error("Script parsing failed after all attempts");
    return {
      success: false,
      error: `剧本解析失败（尝试 ${MAX_ATTEMPTS} 次）: ${lastError ? formatZodErrors(lastError) : "JSON 解析错误"}`,
      attempts: MAX_ATTEMPTS,
      tokensUsed: totalTokens,
    };
  }
}
