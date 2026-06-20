/**
 * 图像生成编排器
 * 统一入口：角色解析 → 策略选择 → 生成 → 验证 → 重试
 *
 * Stage 2.7：缓存层
 * - 按 prompt+model+style+aspectRatio+referenceImages+negativePrompt 计算 sha256 key
 * - 命中 → 直接返回缓存 URL（仍然经过 face-validator 校验，避免缓存里混入"看起来像但不是同一人"的图）
 * - 未命中 → 正常生成，成功且通过验证后写缓存
 */

import { generateImage } from "@/services/ai";
import { resolveStrategy } from "./strategy-resolver";
import { validateFaceConsistency } from "./face-validator";
import { getPromptCache, setPromptCache } from "@/lib/cache/prompt-cache";
import { createLogger } from "@/lib/logger";
import type {
  OrchestratorRequest,
  OrchestratorResult,
  GenerationStrategy,
  ValidationResult,
} from "./types";

const log = createLogger("services:generation:orchestrator");
const DEFAULT_MAX_RETRIES = 3;

export async function orchestrateImageGeneration(
  request: OrchestratorRequest
): Promise<OrchestratorResult> {
  const maxRetries = request.maxRetries ?? DEFAULT_MAX_RETRIES;

  const decision = resolveStrategy(
    request.characters,
    request.prompt,
    request.imageConfig,
    request.shotType,
    { referenceImagesOverride: request.referenceImages }
  );

  const cacheKeyInput = {
    prompt: decision.enhancedPrompt,
    model: request.imageConfig.model,
    style: request.style,
    aspectRatio: request.aspectRatio,
    referenceImages:
      decision.referenceImageUrls ??
      (decision.referenceImageUrl ? [decision.referenceImageUrl] : []),
    negativePrompt: request.negativePrompt,
  };

  // 缓存命中路径：跳过生成但仍要通过 face-validator 把关
  const cached = await getPromptCache(cacheKeyInput);
  if (cached?.imageUrl) {
    log.debug("Prompt cache hit", { sceneId: request.sceneId });
    const validation = await validateFaceConsistency(
      cached.imageUrl,
      request.characters,
      request.shotType,
      { llmConfig: request.llmConfig }
    );
    if (validation.passed) {
      return {
        imageUrl: cached.imageUrl,
        strategy: (cached.strategy as GenerationStrategy) ?? decision.strategy,
        attemptCount: 0,
        validation,
      };
    }
    log.debug("Cached image failed validation, regenerating", {
      sceneId: request.sceneId,
    });
  }

  let lastValidation: ValidationResult | undefined;
  let imageUrl = "";

  // 角色一致性 seed：基于主角色 ID 哈希得到稳定值，跨镜头同角色复用。
  // 没有主角色（纯环境镜头）时不传 seed，让 provider 走默认随机。
  const primaryCharId = request.characters?.[0]?.id;
  const seed =
    typeof primaryCharId === "string" && primaryCharId.length > 0
      ? hashStringToSeed(primaryCharId)
      : undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    imageUrl = await generateImage({
      prompt: decision.enhancedPrompt,
      referenceImage: decision.referenceImageUrl,
      referenceImages: decision.referenceImageUrls,
      negativePrompt: request.negativePrompt,
      aspectRatio: request.aspectRatio,
      style: request.style,
      seed,
      config: request.imageConfig,
    });

    lastValidation = await validateFaceConsistency(
      imageUrl,
      request.characters,
      request.shotType,
      { llmConfig: request.llmConfig }
    );

    if (lastValidation.passed || !lastValidation.shouldRetry) {
      // 只缓存通过验证的结果；验证放行但 passed=false 的边缘情况也放行但不缓存
      if (lastValidation.passed) {
        void setPromptCache(cacheKeyInput, {
          imageUrl,
          strategy: decision.strategy,
        });
      }
      return {
        imageUrl,
        strategy: decision.strategy,
        attemptCount: attempt,
        validation: lastValidation,
      };
    }
  }

  // 所有重试用尽，返回最后一次结果
  return {
    imageUrl,
    strategy: decision.strategy,
    attemptCount: maxRetries,
    validation: lastValidation,
  };
}

export type {
  OrchestratorRequest,
  OrchestratorResult,
  GenerationStrategy,
  ValidationResult,
};

/**
 * 把字符串稳定地映射到 [0, 2^31-1) 区间作为 seed。
 * 用 32 位 FNV-1a，无依赖、纯函数；同一 character.id 每次得到同一 seed。
 *
 * 导出供三视图定妆复用：定妆与分镜出图必须用同一 seed，才能让角色身份
 * 锚定在同一种子上（角色一致性闭环）。两处务必调用此函数，不要各写一份。
 */
export function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // 转无符号 32 位，限制在 [0, 2^31-1) 兼容多数 provider 的 seed 范围
  return (hash >>> 0) % 0x7fffffff;
}
