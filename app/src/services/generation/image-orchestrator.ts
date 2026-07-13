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
import {
  composeReferenceGrid,
  type ReferenceCell,
} from "./reference-composite";
import { getPromptCache, setPromptCache } from "@/lib/cache/prompt-cache";
import { createLogger } from "@/lib/logger";
import type { SceneCharacterInfo } from "./types";
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
    {
      referenceImagesOverride: request.referenceImages,
      iterateMode: request.iterate,
    }
  );

  // 多角色参考图归一：≥2 张参考图时，编辑型端点（OpenAI /images/edits 等）
  // 会把多张图当图层融合重画，导致多个角色互相污染、谁都不像。这里把每个角色
  // 的定妆图横向拼成【一张】带名字标签的合成参考图，只喂一张底图，模型即可分清
  // 谁是谁（多角色一致性根治）。
  //
  // 触发只看两件事：① 非迭代（迭代时参考图是上一版整图，拼接会破坏构图）；
  // ② 场景解析出 ≥2 个各自带参考图的角色。不看 request.referenceImages 的来源——
  // 手动路径的 referenceImages 本就装着角色定妆图（正是要合成的对象），迭代整图
  // 已被 !iterate 挡住。以 buildReferenceCells 的「每角色一张代表图」为准，避免
  // 把同一角色的三视图误当多角色（decision.referenceImageUrls 可能含三视图多张）。
  //
  // 合成结果覆写参考图与 prompt，使缓存 key/生成/验证全链自动改用合成图
  // （一处改动、全链一致 + 缓存正确）。
  let effectiveRefUrl = decision.referenceImageUrl;
  let effectiveRefUrls = decision.referenceImageUrls;
  let effectivePrompt = decision.enhancedPrompt;
  const referenceCells = request.iterate
    ? []
    : buildReferenceCells(request.characters);
  if (
    (decision.referenceImageUrls?.length ?? 0) >= 2 &&
    referenceCells.length >= 2
  ) {
    try {
      const composed = await composeReferenceGrid(referenceCells);
      effectiveRefUrl = composed;
      effectiveRefUrls = [composed];
      // 语义配套：告诉模型这张底图并排展示了多个角色（名字已标注），
      // 让它按各自形象把角色画进场景，而不是只画第一个或融合成一人。
      // 前置进 prompt，且必须进 cacheKey（下方复用 effectivePrompt）。
      const names = referenceCells
        .map((c) => c.label)
        .filter(Boolean)
        .join(", ");
      effectivePrompt =
        `The reference image shows ${referenceCells.length} characters side by side` +
        (names ? ` (labeled: ${names})` : "") +
        `. Render each of them in the scene keeping their exact appearance and identity from the reference. ` +
        decision.enhancedPrompt;
      log.info("多角色参考图已合成为单张", {
        sceneId: request.sceneId,
        characterCount: referenceCells.length,
      });
    } catch (err) {
      // 合成失败不阻断出图：退回原多图路径（至少不比现状差），仅记日志
      log.warn("参考图合成失败，回退多图路径", {
        sceneId: request.sceneId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const cacheKeyInput = {
    prompt: effectivePrompt,
    model: request.imageConfig.model,
    style: request.style,
    aspectRatio: request.aspectRatio,
    referenceImages:
      effectiveRefUrls ?? (effectiveRefUrl ? [effectiveRefUrl] : []),
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
  const baseSeed =
    typeof primaryCharId === "string" && primaryCharId.length > 0
      ? hashStringToSeed(primaryCharId)
      : undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 失败换策略：首次用身份 seed（一致性最强）；重试时在身份 seed 上
    // 加偏移换随机性——保持参考图（身份锚）不变但换种子，避免同 seed+同
    // prompt 死磕重复失败（feat-creative P1）。
    const seed =
      baseSeed === undefined
        ? undefined
        : (baseSeed + (attempt - 1)) % 0x7fffffff;
    imageUrl = await generateImage({
      prompt: effectivePrompt,
      referenceImage: effectiveRefUrl,
      referenceImages: effectiveRefUrls,
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
 * 从场景角色列表构建合成参考图的格子：每个角色取【一张】最具代表性的参考图
 * （优先定妆脸 canonicalImageUrl，回退首张多角度参考），配上角色名标签。
 *
 * 只取每角色一张（而非三视图全塞）：多角色 × 三视图会让合成图过宽、每格过小，
 * 稀释身份信息。定妆正面脸是身份识别度最高的单图。按 role 排序（primary 在前）。
 */
function buildReferenceCells(
  characters: SceneCharacterInfo[]
): ReferenceCell[] {
  const ordered = [...characters].sort(
    (a, b) => roleRank(a.role) - roleRank(b.role)
  );
  const cells: ReferenceCell[] = [];
  const seen = new Set<string>();
  for (const c of ordered) {
    const url = c.canonicalImageUrl || c.referenceImageUrls?.[0];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    cells.push({ url, label: c.name });
  }
  return cells;
}

function roleRank(role: SceneCharacterInfo["role"]): number {
  return role === "primary" ? 0 : role === "secondary" ? 1 : 2;
}

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
