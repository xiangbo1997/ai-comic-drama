/**
 * NarrativeObserver — 叙事连贯评审 (P3.5 闭环3)
 *
 * 从导演视角评审整个分镜序列（叙事连贯/角色连续/镜头多样），返回 ObserverVerdict。
 * 与 ObserverAgent（评单帧图像）互补：这里评的是"故事讲得好不好"。
 *
 * 纯文本评审（分镜是文本结构，无需多模态），复用 chatCompletion。
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import {
  STORYBOARD_REVIEW_SYSTEM,
  buildStoryboardReviewPrompt,
  type SceneSummary,
} from "@/lib/prompts/agent-prompts";
import { createLogger } from "@/lib/logger";
import type { ObserverVerdict, WorkflowContext } from "./types";

const log = createLogger("agent:narrative-observer");

const VerdictSchema = z.object({
  pass: z.boolean(),
  score: z.object({
    overall: z.number().min(0).max(100),
    dimensions: z.record(z.string(), z.number()),
    pass: z.boolean(),
    feedback: z.string().optional(),
  }),
  retryable: z.boolean(),
  suggestions: z.array(z.string()),
});

function extractJSON(text: string): unknown {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) return JSON.parse(block[1].trim());
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) return JSON.parse(obj[0]);
  throw new Error("No JSON in narrative review response");
}

/**
 * 评审分镜序列叙事质量。失败时返回 null（由闭环按 acceptOnEvalFailure 处理）。
 */
export async function reviewStoryboard(
  scenes: SceneSummary[],
  ctx: WorkflowContext
): Promise<ObserverVerdict | null> {
  if (!ctx.config.llm) return null;
  try {
    const response = await chatCompletion(
      [
        { role: "system", content: STORYBOARD_REVIEW_SYSTEM },
        { role: "user", content: buildStoryboardReviewPrompt(scenes) },
      ],
      { temperature: 0.2, maxTokens: 1024, config: ctx.config.llm }
    );
    const parsed = VerdictSchema.safeParse(extractJSON(response));
    if (parsed.success) {
      log.info(
        `Narrative verdict: pass=${parsed.data.pass}, score=${parsed.data.score.overall}`
      );
      return parsed.data as ObserverVerdict;
    }
    log.warn("Narrative review validation failed");
    return null;
  } catch (err) {
    log.warn(
      `Narrative review failed: ${err instanceof Error ? err.message : "Unknown"}`
    );
    return null;
  }
}
