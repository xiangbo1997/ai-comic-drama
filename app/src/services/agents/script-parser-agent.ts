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
import { parseLooseJSON } from "@/lib/json-repair";
import { resolveLLMParams } from "./llm-params";
import { calibrateSceneDurations } from "@/lib/shot-timing";
import {
  compressNovel,
  NOVEL_COMPRESS_THRESHOLD,
} from "@/services/novel-ingest";
import { buildEventMapBlock } from "@/lib/prompts";
import { CameraMovementSchema } from "./schemas";
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
// LLM 导演增强：cameraMovement 收窄为 13 值枚举，非法值 catch 回落 undefined
// （不因运镜写错整镜校验失败）；actionBeat 可选中文字符串。
const SceneScriptSchema = z.object({
  id: z.number(),
  shotType: z.string(),
  description: z.string().min(10),
  characters: z.array(z.string()),
  dialogue: z.string().nullable(),
  narration: z.string().nullable(),
  emotion: z.string(),
  // 上限放宽到 60（与 prompt「1-60s，系统自动分段」一致）；具体值随后由
  // calibrateSceneDurations 按对白驱动校准，不再依赖 LLM 拍脑袋的数字。
  duration: z.number().min(1).max(60),
  cameraAngle: z.string().optional(),
  lighting: z.string().optional(),
  composition: z.string().optional(),
  colorPalette: z.string().optional(),
  cameraMovement: CameraMovementSchema.optional().catch(undefined),
  actionBeat: z.string().optional(),
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

/**
 * 从 LLM 响应中提取 JSON
 * Hotfix 2026-05-20：使用 parseLooseJSON 容错（处理 trailing comma / 智能引号 /
 * 单引号 / 注释 / 控制字符等 LLM 常见输出不规范），失败仍由 Zod 接住做语义校验。
 */
function extractJSON(text: string): unknown {
  return parseLooseJSON(text);
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
    // 长篇小说摄取：与手动解析路径对等——超阈值先分块压缩再解析。
    // llmConfig 缺失（保持现状行为）或压缩内部降级时，原文继续，不阻断解析。
    let parseText = input.text;
    // 全书事件地图：调用方（如 parse 路由）已在压缩阶段构建并传入时优先沿用，
    // 避免本 Agent 对已压缩正文二次压缩时把它覆盖为空。
    let eventMap = input.eventMap;
    const llmConfig = ctx.config.llm;
    if (llmConfig && input.text.length > NOVEL_COMPRESS_THRESHOLD) {
      try {
        const compressed = await compressNovel(input.text, llmConfig);
        if (compressed.compressed) {
          parseText = compressed.text;
          // 仅在调用方未提供事件地图时，用本次压缩产出的事件卡构建（避免覆盖上游地图）。
          if (!eventMap?.trim() && compressed.eventCards.length > 0) {
            eventMap = buildEventMapBlock(compressed.eventCards);
          }
          log.info(
            `剧本压缩：${compressed.originalLength} → ${compressed.compressedLength} 字`
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`剧本压缩失败，原文继续解析：${message}`);
      }
    }
    // 用压缩后的文本与事件地图替换后续所有引用，保持 input 语义单一入口
    input = { ...input, text: parseText, eventMap };

    let totalTokens = 0;
    let lastRawOutput = "";
    let lastZodError: z.ZodError | null = null;
    /**
     * Hotfix3 (2026-05-21)：跟踪非 Zod 错误（超时 / 网络 / JSON 解析失败等）。
     * 之前所有非 Zod 错误都被默认归类为"JSON 解析错误"，误导用户排查方向 ——
     * 真实场景大多是 LLM 上游超时或网络抖动。
     */
    let lastNonZodError: string | null = null;

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
                content: buildScriptParserUserPrompt(
                  input.text,
                  input.seriesContext,
                  input.eventMap
                ),
              },
            ]
          : [
              { role: "system" as const, content: SCRIPT_PARSER_SYSTEM },
              {
                role: "user" as const,
                content: buildScriptParserUserPrompt(
                  input.text,
                  input.seriesContext,
                  input.eventMap
                ),
              },
              {
                role: "assistant" as const,
                content: lastRawOutput.slice(0, 3000),
              },
              {
                role: "user" as const,
                content: buildScriptParserRepairPrompt(
                  lastRawOutput,
                  lastZodError
                    ? formatZodErrors(lastZodError)
                    : (lastNonZodError ?? "JSON parse failed")
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
          // 时长校准（断裂 C 修复）：把 LLM 拍脑袋的 duration 校准为「对白驱动」的
          // 确定值——对白镜不短于朗读时长，空镜不被凑长。下游（视频分段/TTS/导出）
          // 无需改动即受益。immutable：不改动其它字段。
          const calibrated = {
            ...result.data,
            scenes: calibrateSceneDurations(result.data.scenes),
          };
          return {
            success: true,
            data: calibrated as ScriptArtifact,
            reasoning: `成功解析剧本，提取了 ${calibrated.scenes.length} 个分镜和 ${calibrated.characters.length} 个角色`,
            attempts: attempt,
            tokensUsed: totalTokens,
          };
        }

        lastZodError = result.error;
        log.warn(
          `Attempt ${attempt} validation failed: ${formatZodErrors(result.error)}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Attempt ${attempt} failed: ${message}`);
        lastRawOutput = message;
        lastNonZodError = message;
      }
    }

    log.error("Script parsing failed after all attempts");

    // Hotfix3：把真实错因传递出来，让用户/运维能定位（超时 vs 上游错误 vs Zod 校验失败）
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
      error: `剧本解析失败（尝试 ${MAX_ATTEMPTS} 次）：${failureReason}`,
      attempts: MAX_ATTEMPTS,
      tokensUsed: totalTokens,
    };
  }
}
