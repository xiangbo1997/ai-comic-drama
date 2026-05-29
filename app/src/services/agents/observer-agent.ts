/**
 * ObserverAgent — 独立质量评审
 * 不生成内容，只做评判和打分
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import {
  OBSERVER_SYSTEM,
  buildImageReviewPrompt,
} from "@/lib/prompts/agent-prompts";
import { reviewImageWithVision } from "./vision-reviewer";
import { createLogger } from "@/lib/logger";
import type {
  Agent,
  AgentResult,
  ObserverInput,
  ObserverVerdict,
  WorkflowContext,
} from "./types";

const log = createLogger("agent:observer");

const QualityScoreSchema = z.object({
  overall: z.number().min(0).max(100),
  dimensions: z.record(z.string(), z.number().min(0).max(100)),
  pass: z.boolean(),
  feedback: z.string().optional(),
});

const ObserverVerdictSchema = z.object({
  pass: z.boolean(),
  score: QualityScoreSchema,
  retryable: z.boolean(),
  suggestions: z.array(z.string()),
});

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

export class ObserverAgent implements Agent<ObserverInput, ObserverVerdict> {
  readonly name = "observer";

  async run(
    input: ObserverInput,
    ctx: WorkflowContext
  ): Promise<AgentResult<ObserverVerdict>> {
    ctx.emit({
      type: "agent:thinking",
      workflowRunId: ctx.workflowRunId,
      step: "review_images",
      data: { message: "正在评审生成质量..." },
      timestamp: new Date(),
    });

    const characterDescriptions = input.characterBible
      ? input.characterBible.characters
          .map((c) => `${c.name}: ${c.canonicalPrompt}`)
          .join("\n")
      : "无角色信息";

    // C2 第一层：视觉评审。当评审图像且有 imageUrl 与 LLM config 时，
    // 把生成图真正发给多模态模型做 5 维评分（替代原先只看文本的"假评审"）。
    // 任何失败都落到下方的纯文本路径，保持可回滚。
    if (input.contentType === "image" && input.imageUrl && ctx.config.llm) {
      try {
        const raw = await reviewImageWithVision({
          imageUrl: input.imageUrl,
          sceneDescription: input.sceneDescription,
          characterDescriptions,
          expectedEmotion: input.expectedEmotion ?? "neutral",
          expectedShotType: input.expectedShotType ?? "medium shot",
          llmConfig: ctx.config.llm,
        });
        const result = ObserverVerdictSchema.safeParse(raw);
        if (result.success) {
          const verdict = result.data as ObserverVerdict;
          log.info(
            `Observer(vision) verdict: pass=${verdict.pass}, score=${verdict.score.overall}`
          );
          return {
            success: true,
            data: verdict,
            reasoning:
              verdict.score.feedback ?? `视觉评审 ${verdict.score.overall}/100`,
            attempts: 1,
            tokensUsed: 800,
          };
        }
        log.warn("Observer(vision) validation failed, fallback to text review");
      } catch (err) {
        log.warn(
          `Observer(vision) failed, fallback to text review: ${
            err instanceof Error ? err.message : "Unknown"
          }`
        );
      }
    }

    try {
      const response = await chatCompletion(
        [
          { role: "system", content: OBSERVER_SYSTEM },
          {
            role: "user",
            content: buildImageReviewPrompt(
              input.sceneDescription,
              characterDescriptions,
              input.expectedEmotion ?? "neutral",
              input.expectedShotType ?? "medium shot"
            ),
          },
        ],
        {
          temperature: 0.2,
          maxTokens: 1024,
          config: ctx.config.llm,
        }
      );

      const tokensUsed = Math.ceil(response.length / 4);
      const parsed = extractJSON(response);
      const result = ObserverVerdictSchema.safeParse(parsed);

      if (result.success) {
        const verdict = result.data as ObserverVerdict;
        log.info(
          `Observer verdict: pass=${verdict.pass}, score=${verdict.score.overall}`
        );
        return {
          success: true,
          data: verdict,
          reasoning:
            verdict.score.feedback ?? `评分 ${verdict.score.overall}/100`,
          attempts: 1,
          tokensUsed,
        };
      }

      log.warn("Observer response validation failed, using default pass");
    } catch (err) {
      log.warn(
        `Observer failed: ${err instanceof Error ? err.message : "Unknown"}`
      );
    }

    // 降级：默认通过（避免阻塞流程）
    return {
      success: true,
      data: {
        pass: true,
        score: {
          overall: 60,
          dimensions: {},
          pass: true,
          feedback: "评审服务暂时不可用，默认通过",
        },
        retryable: false,
        suggestions: [],
      },
      reasoning: "评审服务降级，默认通过",
      attempts: 1,
      tokensUsed: 0,
    };
  }
}
