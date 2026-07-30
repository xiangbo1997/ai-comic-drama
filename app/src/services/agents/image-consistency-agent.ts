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
import {
  buildEmotionPhrase,
  inferEmotionIntensity,
} from "@/lib/prompts/emotion-grammar";
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
        initialState: {
          prompt: this.augmentImagePrompt(
            input.scene.imagePrompt,
            input.scene.emotion,
            input.scene.shotType,
            ctx.config.style,
            input.aspectRatio
          ),
        },
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

  /**
   * 确定性追加漫剧化关键帧三特性（与手动路径 buildEnhancedPrompt 对等）。
   *
   * 断裂背景：手动出图走 lib/prompt-builder 的 buildEnhancedPrompt，把「情绪语法」
   * （夸张表情 + 漫画符号）与「9:16 竖屏构图基线」确定性拼进 prompt；自动 workflow
   * 直接用 LLM 产出的 imagePrompt，这两项全部缺失——同一部剧手动出的高潮镜有夸张
   * 表演，一键出的却是平静插画。
   *
   * 为什么不复用 buildEnhancedPrompt：它要求 SceneAnalysis（角色动作/环境/光线的
   * 结构化分析结果），而本 Agent 只有 LLM 的成品 imagePrompt，没有可拆解的结构。
   * 故这里只补「与 SceneAnalysis 无关、纯由 emotion/shotType/画幅 派生」的两段，
   * 其余段落（风格锚定/角色特征/质量词）由 LLM 的 imagePrompt 与 orchestrator 负责。
   *
   * 段序对齐手动路径：镜头语言（竖屏构图）在前、情绪在后。
   *
   * 去重：LLM 的 imagePrompt 可能已自带竖屏/夸张表情类描述，重复叠加会稀释权重
   * （与「角色提示词加权」同类的语义稀释问题）。故各段先做关键词探测，命中即跳过——
   * 宁可少加一次，也不制造前后矛盾或权重内耗的重复段。
   */
  private augmentImagePrompt(
    imagePrompt: string,
    emotion?: string | null,
    shotType?: string | null,
    style?: string | null,
    aspectRatio?: "1:1" | "9:16" | "16:9"
  ): string {
    const parts: string[] = [];
    const lower = imagePrompt.toLowerCase();

    // 1. 9:16 竖屏构图基线（与 prompt-builder.ts 同一文案，保持两路径一致）
    if (
      aspectRatio === "9:16" &&
      !lower.includes("vertical composition") &&
      !lower.includes("竖屏")
    ) {
      parts.push(
        "vertical composition, subject in upper two-thirds, strong vertical depth"
      );
    }

    // 2. 情绪语法：强度由 emotion × 景别推断（SceneArtifact 无 isClimax 字段，
    //    与手动路径 Scene 未持久化 emotionIntensity 时的兜底同一函数）。
    //    画风门控在 buildEmotionPhrase 内部完成（写实/油画自动无漫画符号）。
    const alreadyExaggerated =
      lower.includes("exaggerated") ||
      lower.includes("夸张") ||
      lower.includes("impact frame");
    if (!alreadyExaggerated) {
      const emotionPhrase = buildEmotionPhrase(
        emotion,
        inferEmotionIntensity(emotion, shotType),
        style
      );
      if (emotionPhrase) parts.push(emotionPhrase);
    }

    if (parts.length === 0) return imagePrompt;
    return [imagePrompt, ...parts].join(", ");
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
