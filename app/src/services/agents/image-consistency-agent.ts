/**
 * ImageConsistencyAgent — 图像一致性 Agent
 * 复用 strategy-resolver + 增加 Reflection 循环
 */

import { generateImage } from "@/services/ai";
import { chatCompletion } from "@/services/ai";
import { resolveStrategy } from "@/services/generation/strategy-resolver";
import {
  REFLECTION_SYSTEM,
  buildReflectionPrompt,
} from "@/lib/prompts/agent-prompts";
import { ObserverAgent } from "./observer-agent";
import { createLogger } from "@/lib/logger";
import type {
  Agent,
  AgentResult,
  ImageGenerationInput,
  ImageArtifact,
  WorkflowContext,
  CharacterBibleEntry,
} from "./types";
import type { SceneCharacterInfo } from "@/services/generation/types";

const log = createLogger("agent:image-consistency");

export class ImageConsistencyAgent implements Agent<
  ImageGenerationInput,
  ImageArtifact
> {
  readonly name = "image_consistency";
  private observer = new ObserverAgent();

  async run(
    input: ImageGenerationInput,
    ctx: WorkflowContext
  ): Promise<AgentResult<ImageArtifact>> {
    const maxRounds = ctx.config.maxImageReflectionRounds;
    let totalTokens = 0;
    let bestResult: ImageArtifact | null = null;
    let bestScore = 0;

    // 构造 SceneCharacterInfo（对接已有 strategy-resolver）
    const sceneCharacters = this.buildSceneCharacters(
      input.scene.characters,
      input.characterBible,
      input.existingReferenceImages
    );

    // 使用角色圣经的 canonical prompt 增强场景 prompt
    let currentPrompt = input.scene.imagePrompt;

    for (let round = 1; round <= maxRounds + 1; round++) {
      ctx.emit({
        type: round === 1 ? "step:started" : "agent:reflection",
        workflowRunId: ctx.workflowRunId,
        step: "generate_images",
        data: {
          sceneId: input.scene.id,
          round,
          message:
            round === 1
              ? `正在生成场景 ${input.scene.id} 的图像...`
              : `图像质量不达标，正在优化提示词（第 ${round} 次）...`,
        },
        timestamp: new Date(),
      });

      try {
        // 1. 策略选择（复用已有逻辑）
        const imageConfig = ctx.config.image;
        if (!imageConfig) {
          return {
            success: false,
            error: "未配置图像生成服务",
            attempts: round,
            tokensUsed: totalTokens,
          };
        }

        const decision = resolveStrategy(
          sceneCharacters,
          currentPrompt,
          imageConfig,
          input.scene.shotType
        );

        // 2. 生成图像
        const imageUrl = await generateImage({
          prompt: decision.enhancedPrompt,
          referenceImage: decision.referenceImageUrl,
          aspectRatio: "9:16",
          style: ctx.config.style,
          config: imageConfig,
        });

        // 3. Observer 评审
        const observerResult = await this.observer.run(
          {
            contentType: "image",
            imageUrl,
            sceneDescription: input.scene.description,
            characterBible: input.characterBible,
            expectedEmotion: input.scene.emotion,
            expectedShotType: input.scene.shotType,
          },
          ctx
        );

        totalTokens += observerResult.tokensUsed;

        const verdict = observerResult.data;
        if (!verdict) {
          // Observer 失败，默认接受
          return {
            success: true,
            data: {
              sceneId: input.scene.id,
              imageUrl,
              strategy: decision.strategy,
              attempts: round,
            },
            reasoning: "Observer 不可用，接受当前结果",
            attempts: round,
            tokensUsed: totalTokens,
          };
        }

        // 记录最佳结果
        if (verdict.score.overall > bestScore) {
          bestScore = verdict.score.overall;
          bestResult = {
            sceneId: input.scene.id,
            imageUrl,
            strategy: decision.strategy,
            attempts: round,
            quality: verdict.score,
          };
        }

        // 4. 通过检查
        if (verdict.pass) {
          log.info(
            `Scene ${input.scene.id} image passed on round ${round}, score=${verdict.score.overall}`
          );
          return {
            success: true,
            data: bestResult!,
            reasoning: `图像通过质量评审（评分 ${verdict.score.overall}/100）`,
            attempts: round,
            tokensUsed: totalTokens,
          };
        }

        // 5. 不可重试
        if (!verdict.retryable || round > maxRounds) {
          break;
        }

        // 6. Reflection：优化提示词
        currentPrompt = await this.reflectAndRefine(
          currentPrompt,
          verdict.score.feedback ?? "",
          verdict.suggestions,
          ctx
        );
        totalTokens += 200; // 粗略估算 reflection token
      } catch (err) {
        log.error(
          `Round ${round} failed: ${err instanceof Error ? err.message : "Unknown"}`
        );
        break;
      }
    }

    // 返回最佳尝试
    if (bestResult) {
      return {
        success: true,
        data: bestResult,
        reasoning: `使用最佳尝试结果（评分 ${bestScore}/100），Reflection 轮次已用尽`,
        attempts: maxRounds + 1,
        tokensUsed: totalTokens,
      };
    }

    return {
      success: false,
      error: "图像生成失败",
      attempts: maxRounds + 1,
      tokensUsed: totalTokens,
    };
  }

  /** 根据 Observer 反馈优化 prompt */
  private async reflectAndRefine(
    originalPrompt: string,
    feedback: string,
    suggestions: string[],
    ctx: WorkflowContext
  ): Promise<string> {
    try {
      const response = await chatCompletion(
        [
          { role: "system", content: REFLECTION_SYSTEM },
          {
            role: "user",
            content: buildReflectionPrompt(
              originalPrompt,
              feedback,
              suggestions
            ),
          },
        ],
        {
          temperature: 0.3,
          maxTokens: 1024,
          config: ctx.config.llm,
        }
      );

      // 直接返回优化后的 prompt 文本
      return response.trim();
    } catch {
      // Reflection 失败，返回原始 prompt
      return originalPrompt;
    }
  }

  /** 将 CharacterBible 转为 strategy-resolver 需要的 SceneCharacterInfo */
  private buildSceneCharacters(
    sceneCharacterNames: string[],
    bible: { characters: CharacterBibleEntry[] },
    existingRefs?: Record<string, string>
  ): SceneCharacterInfo[] {
    return sceneCharacterNames.map((name, idx) => {
      const entry = bible.characters.find((c) => c.name === name);

      return {
        id: `char-${name}`,
        name,
        role: idx === 0 ? "primary" : "secondary",
        description: entry?.description ?? name,
        gender: entry?.appearance.gender ?? null,
        age: entry?.appearance.age ?? null,
        canonicalImageUrl: existingRefs?.[name],
        appearance: entry
          ? {
              id: `appearance-${name}`,
              characterId: `char-${name}`,
              hairStyle: entry.appearance.hairStyle,
              hairColor: entry.appearance.hairColor,
              faceShape: entry.appearance.faceShape,
              eyeColor: entry.appearance.eyeColor,
              bodyType: entry.appearance.bodyType,
              skinTone: entry.appearance.skinTone,
              height: entry.appearance.height,
              accessories: entry.appearance.accessories,
              freeText: entry.canonicalPrompt,
            }
          : null,
      };
    });
  }
}
