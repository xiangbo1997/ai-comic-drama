/**
 * ImageConsistencyAgent — 图像一致性 Agent
 * 复用 strategy-resolver + 增加 Reflection 循环
 */

import { chatCompletion } from "@/services/ai";
import { orchestrateImageGeneration } from "@/services/generation";
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

    // 构造 SceneCharacterInfo：优先用 workflow-engine 从 DB 解析好的角色
    // （含真实 character.id / canonicalImageUrl / referenceImages / appearance），
    // 缺失时回退到 characterBible 推断（旧行为，canonicalImageUrl 为空 → prompt_only）。
    const sceneCharacters = this.buildSceneCharacters(
      input.scene.characters,
      input.characterBible,
      input.resolvedCharacters,
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
          // 收口到统一编排器（与手动路径 api/generate/image 一致）：
          // 内部完成 策略选择 → 参考图注入 → 身份 seed 复用 → 人脸一致性验证
          // → seed-change 重试 → prompt 缓存。此前直连 generateImage 时以上全部失效，
          // canonicalImageUrl 永远拿不到 → 同角色跨镜头漂移（本次修复的根因）。
          //
          // 闭环交互：Observer(本 Agent) 做「语义/情绪/景别」LLM 评审并 reflect prompt；
          // orchestrator 内部的 face-validator 重试做「人脸一致性」把关。二者维度不同、
          // 不重叠。为防成本失控，把 orchestrator 单轮 maxRetries 收到 1（人脸校验仅重生成一次），
          // 让「多轮重试」的预算集中在外层 Observer 反思上，避免 Observer×orchestrator 相乘放大。
          const result = await orchestrateImageGeneration({
            prompt: state.prompt,
            sceneId: input.sceneDbId,
            projectId: ctx.projectId,
            characters: sceneCharacters,
            shotType: input.scene.shotType,
            emotion: input.scene.emotion,
            style: ctx.config.style,
            aspectRatio: input.aspectRatio,
            imageConfig,
            llmConfig: ctx.config.llm,
            userId: ctx.userId,
            negativePrompt: input.negativePrompt,
            // 朝向感知三视图选择：分镜画面线索透传，orchestrator 据此挑对应朝向参考图。
            // SceneArtifact 有 description/cameraAngle/composition 字段。
            sceneFacingHints: {
              description: input.scene.description,
              cameraAngle: input.scene.cameraAngle,
              composition: input.scene.composition,
            },
            maxRetries: 1,
          });
          return { imageUrl: result.imageUrl, strategy: result.strategy };
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
              // 色彩一致性门禁：把全片统一色板传给 Observer，让「色调一致性」维度
              // 有基准可评（缺省时该维度退化为一般色彩合理性判断）。
              expectedPalette: input.seriesPalette,
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

  /**
   * 将场景角色转为 orchestrator 需要的 SceneCharacterInfo。
   *
   * 优先级：
   * 1. resolvedCharacters（workflow-engine 从 DB 查好的真实角色，含 canonicalImageUrl/id）
   *    —— 按 sceneCharacterNames 的顺序对齐并回填 role（第一个 = primary）。
   * 2. 回退到 characterBible 推断（旧行为，canonicalImageUrl 只能取 existingRefs）。
   */
  private buildSceneCharacters(
    sceneCharacterNames: string[],
    bible: { characters: CharacterBibleEntry[] },
    resolvedCharacters?: SceneCharacterInfo[],
    existingRefs?: Record<string, string>
  ): SceneCharacterInfo[] {
    // 有 DB 解析结果时优先使用（真正注入三视图/定妆参考图）
    if (resolvedCharacters && resolvedCharacters.length > 0) {
      const byName = new Map(resolvedCharacters.map((c) => [c.name, c]));
      const ordered = sceneCharacterNames
        .map((name, idx) => {
          const c = byName.get(name);
          if (!c) return null;
          // 按场景出场顺序重定 role：第一个角色为 primary（seed 锚定主角色）
          return {
            ...c,
            role: (idx === 0
              ? "primary"
              : "secondary") as SceneCharacterInfo["role"],
          };
        })
        .filter((c): c is SceneCharacterInfo => c !== null);
      if (ordered.length > 0) return ordered;
    }

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
