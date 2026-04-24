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

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    imageUrl = await generateImage({
      prompt: decision.enhancedPrompt,
      referenceImage: decision.referenceImageUrl,
      referenceImages: decision.referenceImageUrls,
      negativePrompt: request.negativePrompt,
      aspectRatio: request.aspectRatio,
      style: request.style,
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
