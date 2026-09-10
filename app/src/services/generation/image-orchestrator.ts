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
import { inferFacing, pickAssetUrlForFacing, type Facing } from "./facing";
import { resolveEnvironmentAnchor } from "./environment-anchor";
import { resolveSceneCharacterLooks } from "./scene-looks";
import {
  getPromptCache,
  setPromptCache,
  type PromptCacheKeyInput,
} from "@/lib/cache/prompt-cache";
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

  // 身份闸门防漏护栏：「有 canonicalImageUrl 但没填 trueCanonicalImageUrl」
  // 几乎必定是新增调用路径忘了传真定妆锚 —— face-validator 会一路
  // passthrough("no_true_canonical_anchor")，一致性校验静默空转（workflow 自动
  // 路径就这么漏了很久）。这里打一条 warn 让失效立刻可见，不阻断生成。
  const anchorMissing = request.characters.filter(
    (c) => c.canonicalImageUrl && !c.trueCanonicalImageUrl
  );
  if (anchorMissing.length > 0) {
    log.warn(
      "角色有参考图但缺少真定妆锚（trueCanonicalImageUrl），身份校验将被跳过",
      {
        sceneId: request.sceneId,
        characters: anchorMissing.map((c) => c.name),
      }
    );
  }

  // 朝向推断（朝向感知三视图选择）：据分镜画面线索推一次角色朝向，
  // 供 resolveStrategy 挑参考图 + buildReferenceCells 挑合成格代表图。
  // 无 hints 时默认 front（零回归）。
  const facing: Facing = inferFacing(request.sceneFacingHints ?? {});

  // 场景定妆照（换装变体）：非迭代且有 sceneId 时，据分镜换装标注 characterOutfits
  // 把命中角色的参考图换成对应换装定妆照（服装正确性优先于身份三视图默认服装）。
  // iterate 路径跳过（迭代基底已含服装）。lookOverrides 空时全链零回归。
  const sceneLooks =
    !request.iterate && request.sceneId
      ? await resolveSceneCharacterLooks({
          sceneId: request.sceneId,
          characters: request.characters,
          imageConfig: request.imageConfig,
          userId: request.userId,
          projectId: request.projectId,
          style: request.style,
        })
      : {
          lookOverrides: new Map<string, string>(),
          promptClauses: [],
          outfitByCharacterId: new Map<string, string>(),
        };

  const decision = resolveStrategy(
    request.characters,
    request.prompt,
    request.imageConfig,
    request.shotType,
    {
      referenceImagesOverride: request.referenceImages,
      iterateMode: request.iterate,
      facing,
      lookOverrides: sceneLooks.lookOverrides,
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
  // 换装 prompt 子句前置（进 effectivePrompt→cacheKey）：多角色多条拼接，
  // 声明本镜各角色服装，与参考图换装配套。无换装时 lookPrefix 为空（零回归）。
  const lookPrefix =
    sceneLooks.promptClauses.length > 0
      ? sceneLooks.promptClauses.join(" ") + " "
      : "";
  let effectivePrompt = lookPrefix + decision.enhancedPrompt;
  const referenceCells = request.iterate
    ? []
    : buildReferenceCells(request.characters, facing, sceneLooks.lookOverrides);

  // 场景锚定图（环境一致性）：非迭代且有 sceneId 时，取同地点最早已出图的分镜作锚，
  // 锁背景/布局/光线。锚是增强项，为 null 时全部注入分支自然跳过，绝不阻断出图。
  const anchor =
    !request.iterate && request.sceneId
      ? await resolveEnvironmentAnchor(request.sceneId)
      : null;

  const gridTriggered =
    (decision.referenceImageUrls?.length ?? 0) >= 2 &&
    referenceCells.length >= 2;

  if (gridTriggered) {
    // 优先级 ①：合成格子路径。锚图作为最后一格追加（label "SCENE"），
    // 与角色格一起合成为单张底图，并在 prompt 里声明「SCENE 格是场景环境，
    // 只锁背景/布局/光线，角色形象只跟角色格与文字描述走」。
    const gridCells: ReferenceCell[] = anchor
      ? [...referenceCells, { url: anchor.url, label: "SCENE" }]
      : referenceCells;
    try {
      const composed = await composeReferenceGrid(gridCells);
      effectiveRefUrl = composed;
      effectiveRefUrls = [composed];
      // 语义配套：告诉模型这张底图并排展示了多个角色（名字已标注），
      // 让它按各自形象把角色画进场景，而不是只画第一个或融合成一人。
      // 前置进 prompt，且必须进 cacheKey（下方复用 effectivePrompt）。
      const names = referenceCells
        .map((c) => c.label)
        .filter(Boolean)
        .join(", ");
      const scenePrefix = anchor
        ? `The last cell labeled SCENE is the established scene environment; the background, spatial layout and lighting must stay consistent with it; only follow the character cells and the text description for the characters' appearance — do NOT copy any character from the SCENE cell. `
        : "";
      effectivePrompt =
        lookPrefix +
        `The reference image shows ${referenceCells.length} characters side by side` +
        (names ? ` (labeled: ${names})` : "") +
        `. Render each of them in the scene keeping their exact appearance and identity from the reference. ` +
        scenePrefix +
        decision.enhancedPrompt;
      if (anchor) {
        log.info("场景锚定图已合成进多角色格子", {
          sceneId: request.sceneId,
          anchorSceneId: anchor.sourceSceneId,
        });
      }
      log.info("多角色参考图已合成为单张", {
        sceneId: request.sceneId,
        characterCount: referenceCells.length,
      });
    } catch (err) {
      // 合成失败不阻断出图：退回原多图路径（至少不比现状差），仅记日志。
      // 锚格加入后失败同样回退，行为不劣化。
      log.warn("参考图合成失败，回退多图路径", {
        sceneId: request.sceneId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (anchor) {
    // 未触发合成时，按策略把锚图注入参考列表 / prompt（优先级 ②③④）。
    // 就地改写 effectiveRefUrl/effectiveRefUrls/effectivePrompt，锚图与新增子句
    // 一并进入 cacheKeyInput（下方复用这三个变量）。
    const cap = decision.capability;
    const currentRefs = effectiveRefUrls ?? [];
    const anchorClause =
      " The last reference image shows the established scene environment; keep the background, spatial layout and lighting consistent with it; do NOT copy any character from it.";

    if (
      // ②：reference_edit 且 provider 支持多参考图，且还有余量塞一张
      decision.strategy === "reference_edit" &&
      cap.supportsMultipleReferences &&
      currentRefs.length > 0 &&
      currentRefs.length < cap.maxReferenceImages &&
      !currentRefs.includes(anchor.url)
    ) {
      effectiveRefUrls = [...currentRefs, anchor.url];
      effectivePrompt = lookPrefix + decision.enhancedPrompt + anchorClause;
      log.debug("场景锚定图注入参考列表（②多图余量）", {
        sceneId: request.sceneId,
        anchorSceneId: anchor.sourceSceneId,
      });
    } else if (
      // ③：prompt_only（纯环境镜/无角色）且 provider 支持参考图 → 锚图作唯一参考
      decision.strategy === "prompt_only" &&
      cap.supportsReferenceImage
    ) {
      effectiveRefUrl = anchor.url;
      effectiveRefUrls = [anchor.url];
      decision.strategy = "reference_edit";
      effectivePrompt = lookPrefix + decision.enhancedPrompt + anchorClause;
      log.debug("场景锚定图作唯一参考（③纯环境镜）", {
        sceneId: request.sceneId,
        anchorSceneId: anchor.sourceSceneId,
      });
    } else {
      // ④：其余情况跳过注入
      log.debug("场景锚定图跳过注入（④不满足注入条件）", {
        sceneId: request.sceneId,
        strategy: decision.strategy,
      });
    }
  }

  // 迭代一致性锚（AI 场记修复链路）：iterate 且带前镜锚图时，仅当 provider
  // 支持多参考图才把前镜图追加进参考列表（编辑型端点多张裸图会融合重画，
  // 单参考 provider 保持现状 = 只喂迭代基底图，行为不劣化）。
  // 追加的锚图与子句一并进 effectivePrompt/effectiveRefUrls → cacheKeyInput，缓存正确。
  if (request.iterate && request.iterationAnchorUrl) {
    const cap = decision.capability;
    const currentRefs = effectiveRefUrls ?? [];
    if (
      cap.supportsMultipleReferences &&
      currentRefs.length > 0 &&
      currentRefs.length < cap.maxReferenceImages &&
      !currentRefs.includes(request.iterationAnchorUrl)
    ) {
      effectiveRefUrls = [...currentRefs, request.iterationAnchorUrl];
      effectivePrompt =
        effectivePrompt +
        " The last reference image is the immediately preceding shot in the sequence: strictly match its character costume, hairstyle, accessories, color grading and lighting for visual continuity. The first reference image is the current shot being fixed: keep its composition and framing, only correct the inconsistencies.";
      log.info("迭代一致性锚图已注入参考列表", {
        sceneId: request.sceneId,
      });
    } else {
      log.debug("迭代一致性锚图跳过注入（provider 不支持多参考图或无余量）", {
        sceneId: request.sceneId,
        supportsMultipleReferences: cap.supportsMultipleReferences,
      });
    }
  }

  // 角色一致性 seed：基于主角色 ID 哈希得到稳定值，跨镜头同角色复用。
  // 没有主角色（纯环境镜头）时不传 seed，让 provider 走默认随机。
  //
  // 多候选偏移（candidateIndex）：同一请求出 N 张候选时，每张必须用不同 seed，
  // 否则 N 张同 prompt 同 seed 出的是同一张图，且缓存 key 相同会让第 2..N 张
  // 直接命中第 1 张的缓存——用户按 N 张付费却只拿到 1 张不同的图（P0）。
  const primaryCharId = request.characters?.[0]?.id;
  const candidateIndex = request.candidateIndex ?? 0;
  const baseSeed =
    typeof primaryCharId === "string" && primaryCharId.length > 0
      ? (hashStringToSeed(primaryCharId) + candidateIndex) % 0x7fffffff
      : undefined;

  /**
   * 每次尝试的 seed：首次用身份 seed（一致性最强）；重试时加偏移换随机性——
   * 保持参考图（身份锚）不变但换种子，避免同 seed+同 prompt 死磕重复失败
   * （feat-creative P1）。
   */
  const seedForAttempt = (attempt: number): number | undefined =>
    baseSeed === undefined
      ? undefined
      : (baseSeed + (attempt - 1)) % 0x7fffffff;

  /**
   * 缓存 key：seed 必须参与，否则多候选/重试的不同 seed 会共享同一条缓存。
   * 命中路径与写入路径共用本函数，保证读写 key 严格同构。
   */
  const cacheKeyInputFor = (attempt: number): PromptCacheKeyInput => ({
    prompt: effectivePrompt,
    model: request.imageConfig.model,
    style: request.style,
    aspectRatio: request.aspectRatio,
    referenceImages:
      effectiveRefUrls ?? (effectiveRefUrl ? [effectiveRefUrl] : []),
    negativePrompt: request.negativePrompt,
    seed: seedForAttempt(attempt),
  });

  /**
   * 主角色的原始换装短语（如「白色婚纱」），供一致性闸门豁免服装/配饰维度。
   *
   * 取主角色而非全部角色：闸门只校验主角色（远景/群像本就跳过），把所有角色的
   * 换装拼在一起只会稀释语义，让模型误以为主角也换了别人的那身。
   * 用 outfitByCharacterId 而非 promptClauses：后者是面向出图的英文指令句，
   * 且只在定妆照衍生成功时才有；剧情声明了换装就该豁免，与定妆照成败无关。
   */
  const primaryOutfitNote =
    sceneLooks.outfitByCharacterId.get(
      request.characters.find((c) => c.role === "primary")?.id ?? ""
    ) ?? "";

  // 缓存命中路径：跳过生成但仍要通过 face-validator 把关。
  // 只查「第 1 次尝试」的 key——命中即等价于跳过第 1 次生成。
  const firstAttemptCacheKey = cacheKeyInputFor(1);
  const cached = await getPromptCache(firstAttemptCacheKey);
  if (cached?.imageUrl) {
    log.debug("Prompt cache hit", { sceneId: request.sceneId });
    const validation = await validateFaceConsistency(
      cached.imageUrl,
      request.characters,
      request.shotType,
      {
        llmConfig: request.llmConfig,
        // 剧情意图（换装/战损）与重试余量必须传入，否则一致性闸门的
        // 「有意变化豁免」不生效——婚纱/战损镜会被判服装不一致而白白重试。
        // 缓存命中路径尚未消耗重试，余量给满。
        sceneDescription: request.prompt,
        outfitNote: primaryOutfitNote,
        retriesRemaining: maxRetries,
      }
    );
    if (validation.passed) {
      return {
        imageUrl: cached.imageUrl,
        strategy: (cached.strategy as GenerationStrategy) ?? decision.strategy,
        attemptCount: 0,
        validation,
        // 能力错配告知（如参考图被当前模型忽略）必须透传到结果，
        // 否则防呆只落在服务端日志里、用户永远看不到（A1）
        warnings: decision.warnings,
      };
    }
    log.debug("Cached image failed validation, regenerating", {
      sceneId: request.sceneId,
    });
  }

  let lastValidation: ValidationResult | undefined;
  let imageUrl = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const seed = seedForAttempt(attempt);
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
      {
        llmConfig: request.llmConfig,
        // 同缓存命中路径：传剧情意图以启用换装豁免；重试余量按本轮已用次数递减，
        // 余量耗尽时闸门不再要求重试（避免判定 FAIL 却无处可退时空转烧积分）。
        sceneDescription: request.prompt,
        outfitNote: primaryOutfitNote,
        retriesRemaining: maxRetries - attempt,
      }
    );

    if (lastValidation.passed || !lastValidation.shouldRetry) {
      // 只缓存通过验证的结果；验证放行但 passed=false 的边缘情况也放行但不缓存
      if (lastValidation.passed) {
        // 写入本次 attempt 的 key（与读取路径同构：attempt=1 时即命中路径的 key）
        void setPromptCache(cacheKeyInputFor(attempt), {
          imageUrl,
          strategy: decision.strategy,
        });
      }
      return {
        imageUrl,
        strategy: decision.strategy,
        attemptCount: attempt,
        validation: lastValidation,
        warnings: decision.warnings,
      };
    }
  }

  // 所有重试用尽，返回最后一次结果
  return {
    imageUrl,
    strategy: decision.strategy,
    attemptCount: maxRetries,
    validation: lastValidation,
    warnings: decision.warnings,
  };
}

export type {
  OrchestratorRequest,
  OrchestratorResult,
  GenerationStrategy,
  ValidationResult,
};

/**
 * 从场景角色列表构建合成参考图的格子：每个角色取【一张】最具代表性的参考图，
 * 配上角色名标签。
 *
 * 代表图挑选优先级：
 * ① 换装定妆照（lookOverrides 命中）：服装正确性优先，覆盖朝向感知/canonical 的选择。
 * ② 朝向感知：角色有三视图 referenceAssets 时按分镜朝向挑（背影镜取背视图、侧面镜取
 *    侧视图，避免正脸参考把画面拉回正面）。
 * ③ 无 referenceAssets 时回退既有 canonicalImageUrl || referenceImageUrls[0] 逻辑（零回归）。
 *
 * 只取每角色一张（而非三视图全塞）：多角色 × 三视图会让合成图过宽、每格过小，
 * 稀释身份信息。按 role 排序（primary 在前）。
 */
function buildReferenceCells(
  characters: SceneCharacterInfo[],
  facing: Facing,
  lookOverrides?: Map<string, string>
): ReferenceCell[] {
  const ordered = [...characters].sort(
    (a, b) => roleRank(a.role) - roleRank(b.role)
  );
  const cells: ReferenceCell[] = [];
  const seen = new Set<string>();
  for (const c of ordered) {
    // 换装定妆照优先：服装正确性优先于视角，覆盖朝向/canonical 的选择
    const lookUrl = lookOverrides?.get(c.id);
    const facingUrl = c.referenceAssets?.length
      ? pickAssetUrlForFacing(c.referenceAssets, facing)
      : undefined;
    const url =
      lookUrl || facingUrl || c.canonicalImageUrl || c.referenceImageUrls?.[0];
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
