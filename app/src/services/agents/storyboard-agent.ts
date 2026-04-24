/**
 * StoryboardAgent — 分镜补全
 * 将粗粒度场景补全为带 imagePrompt 的完整分镜
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import {
  STORYBOARD_SYSTEM,
  buildStoryboardPrompt,
} from "@/lib/prompts/agent-prompts";
import { createLogger } from "@/lib/logger";
import { resolveLLMParams } from "./llm-params";
import type {
  Agent,
  AgentResult,
  StoryboardInput,
  StoryboardArtifact,
  SceneArtifact,
  WorkflowContext,
} from "./types";

const log = createLogger("agent:storyboard");

const SceneArtifactSchema = z.object({
  id: z.number(),
  order: z.number(),
  shotType: z.string(),
  description: z.string().min(10),
  imagePrompt: z.string().min(20),
  characters: z.array(z.string()),
  dialogue: z.string().nullable(),
  narration: z.string().nullable(),
  emotion: z.string(),
  duration: z.number().min(1).max(30),
  cameraMovement: z.string().nullable().optional(),
  transition: z.string().nullable().optional(),
});

const StoryboardSchema = z.object({
  scenes: z.array(SceneArtifactSchema).min(1),
});

const MAX_ATTEMPTS = 2;
// 每次处理的场景批次大小
const BATCH_SIZE = 15;

function extractJSON(text: string): unknown {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim());
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No JSON found in response");
}

export class StoryboardAgent implements Agent<
  StoryboardInput,
  StoryboardArtifact
> {
  readonly name = "storyboard";

  async run(
    input: StoryboardInput,
    ctx: WorkflowContext
  ): Promise<AgentResult<StoryboardArtifact>> {
    let totalTokens = 0;
    const allScenes: SceneArtifact[] = [];

    const charRef = input.characterBible.characters.map((c) => ({
      name: c.name,
      canonicalPrompt: c.canonicalPrompt,
      appearance: c.appearance,
    }));

    // 分批处理（超长剧本场景数可能超过 15）
    const batches = this.splitBatches(input.script.scenes, BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];

      ctx.emit({
        type: "agent:thinking",
        workflowRunId: ctx.workflowRunId,
        step: "build_storyboard",
        data: {
          message:
            batches.length === 1
              ? `正在为 ${batch.length} 个分镜生成图像提示词...`
              : `正在处理第 ${batchIdx + 1}/${batches.length} 批分镜（${batch.length} 个）...`,
        },
        timestamp: new Date(),
      });

      const batchResult = await this.processBatch(batch, charRef, ctx);
      totalTokens += batchResult.tokensUsed;

      if (batchResult.scenes.length > 0) {
        allScenes.push(...batchResult.scenes);
      } else {
        // 降级：使用基础数据
        allScenes.push(...this.buildFallbackScenes(batch, charRef));
      }
    }

    // 确保 order 连续
    const orderedScenes = allScenes.map((s, idx) => ({ ...s, order: idx + 1 }));

    log.info(`Storyboard completed: ${orderedScenes.length} scenes`);
    return {
      success: true,
      data: { scenes: orderedScenes },
      reasoning: `为 ${orderedScenes.length} 个分镜生成了完整的图像提示词`,
      attempts: 1,
      tokensUsed: totalTokens,
    };
  }

  private async processBatch(
    scenes: StoryboardInput["script"]["scenes"],
    charRef: Array<{
      name: string;
      canonicalPrompt: string;
      appearance: Record<string, string>;
    }>,
    ctx: WorkflowContext
  ): Promise<{ scenes: SceneArtifact[]; tokensUsed: number }> {
    let tokensUsed = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const storyboardParams = resolveLLMParams(ctx.config, {
          defaultTemperature: 0.4,
          defaultMaxTokens: 8192,
        });
        const response = await chatCompletion(
          [
            { role: "system", content: STORYBOARD_SYSTEM },
            { role: "user", content: buildStoryboardPrompt(scenes, charRef) },
          ],
          {
            temperature: storyboardParams.temperature,
            maxTokens: storyboardParams.maxTokens,
            config: ctx.config.llm,
          }
        );

        tokensUsed += Math.ceil(response.length / 4);

        const parsed = extractJSON(response);
        const result = StoryboardSchema.safeParse(parsed);

        if (result.success) {
          return { scenes: result.data.scenes as SceneArtifact[], tokensUsed };
        }

        log.warn(`Storyboard batch attempt ${attempt} validation failed`);
      } catch (err) {
        log.warn(
          `Storyboard batch attempt ${attempt} failed: ${err instanceof Error ? err.message : "Unknown"}`
        );
      }
    }

    return { scenes: [], tokensUsed };
  }

  /** 降级方案：简单拼接 prompt */
  private buildFallbackScenes(
    scenes: StoryboardInput["script"]["scenes"],
    charRef: Array<{ name: string; canonicalPrompt: string }>
  ): SceneArtifact[] {
    return scenes.map((s, idx) => {
      const charPrompts = s.characters
        .map((name) => {
          const ref = charRef.find((c) => c.name === name);
          return ref ? ref.canonicalPrompt : name;
        })
        .join(", ");

      const imagePrompt = [
        charPrompts,
        s.description,
        `${s.shotType} shot`,
        `${s.emotion} mood`,
        "masterpiece, best quality, highly detailed",
      ]
        .filter(Boolean)
        .join(", ");

      return {
        id: s.id,
        order: idx + 1,
        shotType: s.shotType,
        description: s.description,
        imagePrompt,
        characters: s.characters,
        dialogue: s.dialogue,
        narration: s.narration,
        emotion: s.emotion,
        duration: s.duration,
        cameraMovement: undefined,
        transition: undefined,
      };
    });
  }

  private splitBatches<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }
}
