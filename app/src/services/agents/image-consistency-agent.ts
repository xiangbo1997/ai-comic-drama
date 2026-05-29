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
import { runClosedLoop } from "./closed-loop";
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
    const imageConfig = ctx.config.image;
    if (!imageConfig) {
      return {
        success: false,
        error: "未配置图像生成服务",
        attempts: 1,
        tokensUsed: 0,
      };
    }

    const maxRounds = ctx.config.maxImageReflectionRounds;

    // 构造 SceneCharacterInfo（对接已有 strategy-resolver）
    const sceneCharacters = this.buildSceneCharacters(
      input.scene.characters,
      input.characterBible,
      input.existingReferenceImages
    );

    let totalTokens = 0;

    // P3.5：用通用 ReAct 闭环执行器替代原内联循环（行为等价）。
    // State = 当前 prompt；候选 = { imageUrl, strategy }。
    const result = await runClosedLoop<
      { prompt: string },
      { imageUrl: string; strategy: string }
    >(
      {
        initialState: { prompt: input.scene.imagePrompt },
        maxRounds,
        workflowStep: "generate_images",
        taskLabel: `正在生成场景 ${input.scene.id} 的图像`,
        generate: async (state) => {
          const decision = resolveStrategy(
            sceneCharacters,
            state.prompt,
            imageConfig,
            input.scene.shotType
          );
          const imageUrl = await generateImage({
            prompt: decision.enhancedPrompt,
            referenceImage: decision.referenceImageUrl,
            aspectRatio: "9:16",
            style: ctx.config.style,
            config: imageConfig,
          });
          return { imageUrl, strategy: decision.strategy };
        },
        evaluate: async (candidate) => {
          const observerResult = await this.observer.run(
            {
              contentType: "image",
              imageUrl: candidate.imageUrl,
              sceneDescription: input.scene.description,
              characterBible: input.characterBible,
              expectedEmotion: input.scene.emotion,
              expectedShotType: input.scene.shotType,
            },
            ctx
          );
          totalTokens += observerResult.tokensUsed;
          return observerResult.data ?? null;
        },
        reflect: async (state, verdict) => {
          totalTokens += 200; // 粗略估算 reflection token
          const prompt = await this.reflectAndRefine(
            state.prompt,
            verdict.score.feedback ?? "",
            verdict.suggestions,
            ctx
          );
          return { prompt };
        },
      },
      ctx
    );

    if (!result.best) {
      return {
        success: false,
        error: "图像生成失败",
        attempts: result.rounds,
        tokensUsed: totalTokens,
      };
    }

    // 取最优候选对应的 verdict 质量分（若有）
    const bestRound = result.history.find(
      (h) => h.candidate.imageUrl === result.best!.imageUrl
    );

    log.info(
      `Scene ${input.scene.id} image done: passed=${result.passed}, score=${result.bestScore}, rounds=${result.rounds}`
    );

    return {
      success: true,
      data: {
        sceneId: input.scene.id,
        imageUrl: result.best.imageUrl,
        strategy: result.best.strategy,
        attempts: result.rounds,
        quality: bestRound?.verdict.score,
      },
      reasoning: result.passed
        ? `图像通过质量评审（评分 ${result.bestScore}/100）`
        : `使用最佳尝试结果（评分 ${result.bestScore}/100），Reflection 轮次已用尽`,
      attempts: result.rounds,
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
