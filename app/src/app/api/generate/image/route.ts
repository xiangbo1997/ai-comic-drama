import { auth } from "@/lib/auth";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { chatCompletion } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { getUserImageConfig, getUserLLMConfig } from "@/lib/ai-config";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import {
  type CharacterInfo,
  type SceneAnalysis,
  buildEnhancedPrompt,
  buildSceneAnalysisPrompt,
  parseSceneAnalysisResponse,
  promptStyleFromProtocol,
} from "@/lib/prompt-builder";
import {
  orchestrateImageGeneration,
  normalizeCandidateCount,
  pickRecommendedIndex,
  mergeSimilarityScores,
  scoreCandidate,
} from "@/services/generation";
import type {
  SceneCharacterInfo,
  CharacterRole,
  CandidateScore,
} from "@/services/generation";
import { createLogger } from "@/lib/logger";
import { runWithGenerationSlot } from "@/lib/generation-concurrency";
import { getAnalysisCache, setAnalysisCache } from "@/lib/cache/analysis-cache";
import { loadSeriesMemoryDigest } from "@/lib/series-memory";
import { chargeCredits } from "@/lib/credits";

const log = createLogger("api:generate:image");

// 图像生成成本（积分）
const IMAGE_COST = {
  normal: 1, // 普通生成
  withRef: 3, // 带参考图（角色一致性）
};

/**
 * 三视图参考资产排序：isCanonical desc（定妆图优先）→ qualityScore desc（高分优先）
 * → createdAt asc（早建的稳定），取 url + pose 供 orchestrator 按朝向挑选。
 * 空/缺省返回 undefined，orchestrator 回落既有 canonicalImageUrl 逻辑（零回归）。
 */
function sortReferenceAssets(
  assets:
    | Array<{
        url: string;
        pose: string | null;
        isCanonical: boolean;
        qualityScore: number | null;
        createdAt: Date;
      }>
    | undefined
): Array<{ url: string; pose: string | null }> | undefined {
  if (!assets || assets.length === 0) return undefined;
  return [...assets]
    .sort((a, b) => {
      if (a.isCanonical !== b.isCanonical) return a.isCanonical ? -1 : 1;
      const qa = a.qualityScore ?? -1;
      const qb = b.qualityScore ?? -1;
      if (qa !== qb) return qb - qa;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })
    .map((a) => ({ url: a.url, pose: a.pose }));
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 在事务闭包内 TS 会丢失对 userId 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 应用限流
    const rateLimitResult = await rateLimiters.imageGeneration(request, userId);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    const {
      prompt,
      referenceImage,
      // Stage 修复：客户端三视图会传 referenceImages 数组（front/side/back），
      // 此前未解构导致多张参考图被丢弃，三视图锁形象在服务端实质失效。
      referenceImages,
      aspectRatio,
      style,
      projectId,
      sceneId,
      imageConfigId,
      // Stage 1.3 引入：客户端可显式传入 negativePrompt。orchestrator 将在 Stage 1.4
      // 正式消费（目前先记录，便于观察管线是否打通）。
      negativePrompt,
      // 迭代式生成：iterate=true 时 referenceImages 是「上一版整图」，
      // note 是用户追加指令（"改成夜晚"）——note 会被提权到 finalPrompt 最前，
      // iterate 透传给 orchestrator 切换 reference_edit 措辞。
      note,
      iterate,
      // AI 场记修复：前镜当前图作迭代一致性锚图，orchestrator 按 provider 能力门控注入。
      iterationAnchorUrl,
      // 多候选抽卡档位（批次 2 · 1.4A）：1 / 2 / 4，缺省 1。
      // count=1 时行为与单发生成完全一致（零回归）；2/4 张并行生成后 VLM 择优。
      count,
    } = await request.json();

    // 档位合法化：仅放行 1 / 2 / 4，非法值回落 1（零回归基石）
    const candidateCount = normalizeCandidateCount(count);

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    if (negativePrompt) {
      log.debug("Received negativePrompt from client", {
        sceneId,
        length: String(negativePrompt).length,
      });
    }
    if (referenceImage) {
      log.debug(
        "Received referenceImage from client (activates orchestrator reference_edit)",
        {
          sceneId,
        }
      );
    }

    // 内容安全检查
    const safetyCheck = await contentSafetyMiddleware(prompt, "image");
    if (!safetyCheck.safe) {
      return NextResponse.json(
        {
          error: "内容不符合安全规范",
          reason: safetyCheck.reason,
          blockedKeywords: safetyCheck.blockedKeywords,
        },
        { status: 400 }
      );
    }

    // 使用净化后的提示词
    const safePrompt = safetyCheck.sanitizedText || prompt;

    // 成本预估（编排器使用参考图时成本更高，此处做保守预扣）
    const hasExplicitRef = !!(
      referenceImage ||
      (Array.isArray(referenceImages) && referenceImages.length > 0)
    );
    // 单张预估成本；多候选按 candidateCount × 单价做前置余额校验（实际按成功张数扣费）
    const perImageCost = hasExplicitRef
      ? IMAGE_COST.withRef
      : IMAGE_COST.normal;
    const cost = perImageCost * candidateCount;

    // 检查积分（多候选需 ≥ count × 单张预估）
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user || user.credits < cost) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: cost,
          current: user?.credits ?? 0,
        },
        { status: 400 }
      );
    }

    // IDOR 防护：校验 sceneId 归属当前用户，禁止跨用户篡改/投毒他人分镜
    // （security-cost P0-1）。后续所有 scene.update 据此安全。
    if (sceneId) {
      const ownsScene = await prisma.scene.findFirst({
        where: { id: sceneId, project: { userId: userId } },
        select: { id: true },
      });
      if (!ownsScene) {
        return NextResponse.json({ error: "Scene not found" }, { status: 404 });
      }
    }

    // 如果有场景ID，先更新状态为处理中
    if (projectId && sceneId) {
      await prisma.scene.updateMany({
        where: { id: sceneId },
        data: { imageStatus: "PROCESSING" },
      });
    }

    // 创建生成任务记录（input.userId 供轮询端点做归属校验，同 script/parse 模式）
    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        input: {
          userId,
          prompt,
          referenceImage,
          aspectRatio,
          style,
          imageConfigId,
          // 迭代式生成：留痕用户追加指令与迭代标记，便于排查
          note: note ?? null,
          iterate: iterate ?? false,
          // AI 场记修复：留痕迭代一致性锚图（审计留痕）
          iterationAnchorUrl:
            typeof iterationAnchorUrl === "string" ? iterationAnchorUrl : null,
          // 多候选档位（便于排查抽卡请求）
          count: candidateCount,
        },
        projectId,
        sceneId,
        cost,
      },
    });

    // 异步化（2026-07-04）：生成主体 fire-and-forget 挂在本进程后台执行
    // （systemd 常驻 node，与 workflow / 三视图同模式），POST 立即返回
    // taskId，客户端轮询 GET /api/generate/tasks/[taskId] 取结果。
    // 此前同步 await 数十秒：请求断开即丢结果、无法刷新恢复、受平台超时约束。
    // 扣费语义不变：成功后事务内扣费，失败/僵尸从未扣费无需退款。
    const run = async () => {
      try {
        // 获取用户的图像生成配置
        const imageConfig = await getUserImageConfig(userId, imageConfigId);
        const llmConfig = await getUserLLMConfig(userId);

        if (imageConfigId && !imageConfig) {
          throw new Error(
            "所选图片供应商不可用，请重新选择已测试成功的图像模型配置。"
          );
        }

        // 获取场景和角色信息，构建编排器所需的 SceneCharacterInfo[]
        let enhancedPrompt = safePrompt;
        // 镜头语言是否已由 buildEnhancedPrompt 前置注入（新排序主路径 true）。
        // 为 false 的降级路径（分析失败/无 LLM）才在末尾 tail-append 镜头语言兜底。
        let cinematicsInjected = false;
        let sceneCharacters: SceneCharacterInfo[] = [];
        let shotType: string | undefined;
        // 镜头语言（块内从 scene 取，块外拼进出图 prompt）
        let sceneCinematics: {
          cameraAngle?: string | null;
          lighting?: string | null;
          composition?: string | null;
          colorPalette?: string | null;
        } | null = null;
        // VLM 择优评审上下文（块内从 scene 取，块外传给 scoreCandidate）。
        // 无 sceneId 时回落到用户 prompt / 中性情绪，仍可打分（角色维度亦复用）。
        let sceneDescriptionForReview = safePrompt;
        let sceneEmotionForReview: string | undefined;
        // 朝向感知三视图选择：分镜画面线索（描述/镜头角度/构图），透传 orchestrator
        // 推断角色朝向。无 sceneId 时为 null（朝向按默认 front）。
        let sceneFacingHints: {
          description?: string | null;
          cameraAngle?: string | null;
          composition?: string | null;
        } | null = null;

        if (sceneId) {
          const scene = await prisma.scene.findUnique({
            where: { id: sceneId },
            select: {
              order: true,
              description: true,
              dialogue: true,
              emotion: true,
              isClimax: true,
              shotType: true,
              cameraAngle: true,
              lighting: true,
              composition: true,
              colorPalette: true,
              locationKey: true,
              selectedCharacterIds: true,
              selectedCharacter: {
                select: {
                  id: true,
                  name: true,
                  gender: true,
                  age: true,
                  description: true,
                  referenceImages: true,
                  canonicalImageUrl: true,
                  appearance: true,
                  // 朝向感知三视图选择：带 pose 的参考资产（front/side/back/3quarter）
                  referenceAssets: {
                    select: {
                      url: true,
                      pose: true,
                      isCanonical: true,
                      qualityScore: true,
                      createdAt: true,
                    },
                  },
                },
              },
            },
          });

          shotType = scene?.shotType || undefined;
          sceneCinematics = scene
            ? {
                cameraAngle: scene.cameraAngle,
                lighting: scene.lighting,
                composition: scene.composition,
                colorPalette: scene.colorPalette,
              }
            : null;
          // VLM 择优评审上下文（真实分镜的画面描述 + 情绪，比 prompt 更贴合评审语义）
          if (scene?.description) sceneDescriptionForReview = scene.description;
          sceneEmotionForReview = scene?.emotion || undefined;
          // 朝向线索：优先真实分镜画面描述/镜头角度/构图（比用户 prompt 更贴合）
          sceneFacingHints = scene
            ? {
                description: scene.description,
                cameraAngle: scene.cameraAngle,
                composition: scene.composition,
              }
            : null;

          // 获取角色信息并构建 SceneCharacterInfo
          const buildSceneChar = (
            c: {
              id: string;
              name: string;
              gender: string | null;
              age: string | null;
              description: string | null;
              referenceImages: string[];
              canonicalImageUrl?: string | null;
              appearance?: Record<string, unknown> | null;
              referenceAssets?: Array<{
                url: string;
                pose: string | null;
                isCanonical: boolean;
                qualityScore: number | null;
                createdAt: Date;
              }>;
            },
            index: number
          ): SceneCharacterInfo => ({
            id: c.id,
            name: c.name,
            gender: c.gender,
            age: c.age,
            description: c.description,
            referenceImages: c.referenceImages as string[],
            role: (index === 0 ? "primary" : "secondary") as CharacterRole,
            // 优先用三视图定妆的身份锚点（经 i2i 绑定，更可靠），
            // 缺失时回落到旧 referenceImages[0]（角色一致性闭环）。
            canonicalImageUrl:
              c.canonicalImageUrl || (c.referenceImages as string[])?.[0],
            appearance: c.appearance as SceneCharacterInfo["appearance"],
            // 朝向感知三视图选择：按 isCanonical desc、qualityScore desc 排序后取 url+pose，
            // 供 orchestrator 按分镜朝向挑对应视图。不改变上面的 canonicalImageUrl 回退链。
            referenceAssets: sortReferenceAssets(c.referenceAssets),
            // 场景定妆照换装：用户预设服装（来自 appearance.clothingPresets），
            // 命中且带 imageRef 时换装走用户手挑参考图。老数据 appearance 缺省时为 undefined。
            clothingPresets:
              (c.appearance
                ?.clothingPresets as SceneCharacterInfo["clothingPresets"]) ??
              undefined,
          });

          if ((scene?.selectedCharacterIds?.length ?? 0) > 0) {
            const dbCharacters = await prisma.character.findMany({
              where: { id: { in: scene!.selectedCharacterIds } },
              select: {
                id: true,
                name: true,
                gender: true,
                age: true,
                description: true,
                referenceImages: true,
                canonicalImageUrl: true,
                appearance: true,
                // 朝向感知三视图选择：带 pose 的参考资产
                referenceAssets: {
                  select: {
                    url: true,
                    pose: true,
                    isCanonical: true,
                    qualityScore: true,
                    createdAt: true,
                  },
                },
              },
            });
            sceneCharacters = dbCharacters.map((c, i) => buildSceneChar(c, i));
          } else if (scene?.selectedCharacter) {
            sceneCharacters = [buildSceneChar(scene.selectedCharacter, 0)];
          }

          // LLM 场景分析增强 prompt
          const characters: CharacterInfo[] = sceneCharacters.map((c) => ({
            name: c.name,
            gender: c.gender,
            age: c.age,
            description: c.description,
            referenceImages: c.referenceImages,
            appearance: c.appearance,
          }));

          if (characters.length > 0 && scene?.description && llmConfig) {
            try {
              // 连续性记忆（Deliverable 3）：取相邻镜画面描述（order±1），让分析层
              // 保持人物状态/道具/服装延续、不与前后镜冲突。前镜额外取 lighting/
              // colorPalette/locationKey，用于同地点强制承接光线基调。
              const [prevScene, nextScene] = await Promise.all([
                prisma.scene.findFirst({
                  where: { projectId, order: scene.order - 1 },
                  select: {
                    description: true,
                    lighting: true,
                    colorPalette: true,
                    locationKey: true,
                  },
                }),
                prisma.scene.findFirst({
                  where: { projectId, order: scene.order + 1 },
                  select: { description: true },
                }),
              ]);
              const prevSceneDescription = prevScene?.description || undefined;
              const nextSceneDescription = nextScene?.description || undefined;

              // 同地点光线承接：本镜与上一镜 locationKey 相同时，把前镜的
              // lighting（回落 colorPalette）作为光线基调传给分析层，强制承接，
              // 防止同一地点相邻镜出现昼夜/冷暖漂移。异地点/无标签则不传（正常切换）。
              const sameLocation =
                !!scene.locationKey &&
                !!prevScene?.locationKey &&
                scene.locationKey === prevScene.locationKey;
              const continuityLighting = sameLocation
                ? prevScene?.lighting?.trim() ||
                  prevScene?.colorPalette?.trim() ||
                  undefined
                : undefined;

              // 系列记忆（既定场景/道具/角色状态）：续集时注入分析 prompt，保证
              // 跨集视觉一致。空圣经/非系列返回 null。digest 变化必须进 cache key。
              const seriesContext =
                (await loadSeriesMemoryDigest(projectId, "scene")) || undefined;

              // 场景分析缓存（a7 P1-4）：同分镜重复生成时内容不变，跳过
              // 这次 ~1024 tokens 的 LLM 往返。key 按场景内容+角色名+相邻镜描述+
              // 系列记忆 digest 哈希（任一变化会改变分析指令，故纳入 key）。
              const analysisCacheKey = {
                sceneDescription: scene.description,
                dialogue: scene.dialogue || undefined,
                emotion: scene.emotion || undefined,
                shotType: scene.shotType || undefined,
                characterNames: characters.map((c) => c.name),
                prevSceneDescription,
                nextSceneDescription,
                continuityLighting,
                seriesContext,
              };
              let analysisResponse = await getAnalysisCache(analysisCacheKey);

              if (!analysisResponse) {
                const analysisPrompt = buildSceneAnalysisPrompt({
                  sceneDescription: scene.description,
                  dialogue: scene.dialogue || undefined,
                  characters,
                  emotion: scene.emotion || undefined,
                  shotType: scene.shotType || undefined,
                  prevSceneDescription,
                  nextSceneDescription,
                  continuityLighting,
                  seriesContext,
                });

                analysisResponse = await chatCompletion(
                  [
                    {
                      role: "system",
                      content:
                        "你是一个专业的分镜师和图像生成专家。你的任务是分析场景描述，提取用于图像生成的关键信息。请始终以 JSON 格式输出结果。",
                    },
                    { role: "user", content: analysisPrompt },
                  ],
                  { config: llmConfig, temperature: 0.3, maxTokens: 1024 }
                );
                // 仅成功拿到响应后写缓存（下方 parse 失败会抛，进 catch 降级）
                void setAnalysisCache(analysisCacheKey, analysisResponse);
              }

              const analysis: SceneAnalysis =
                parseSceneAnalysisResponse(analysisResponse);

              // 镜头语言前置注入 + 情绪语法（漫剧化重排）：cinematics 作为高权重
              // 参数进 builder（此前在 route 末尾 tail-append，权重最低），情绪按
              // emotion×景别推断强度驱动夸张表情。promptStyle 按 provider 协议分派
              // （SD 系 booru 标签 / 指令类自然语言）。
              enhancedPrompt = buildEnhancedPrompt({
                style,
                characters,
                analysis,
                shotType: scene.shotType || undefined,
                originalPrompt: safePrompt,
                cinematics: sceneCinematics ?? undefined,
                emotion: scene.emotion,
                isClimax: scene.isClimax,
                aspectRatio,
                promptStyle: promptStyleFromProtocol(imageConfig?.protocol),
              });
              cinematicsInjected = true;
            } catch (analysisError) {
              log.warn(
                "Scene analysis failed, falling back to simple prompt:",
                analysisError
              );
              if (characters.length > 1) {
                const characterNames = characters
                  .map((c) => c.name)
                  .join(" and ");
                enhancedPrompt = `${safePrompt}, scene with ${characters.length} characters: ${characterNames}, multiple characters interacting`;
              }
            }
          } else if (characters.length > 1) {
            const characterNames = characters.map((c) => c.name).join(" and ");
            enhancedPrompt = `${safePrompt}, scene with ${characters.length} characters: ${characterNames}, multiple characters interacting`;
          }
        }

        // 镜头语言 tail-append 兜底：仅在降级路径（buildEnhancedPrompt 未执行，
        // 如分析失败 / 无角色 / 无 LLM）时把 cameraAngle/lighting/composition/
        // colorPalette 拼到末尾，避免这四字段完全丢失。主路径已由 builder 前置
        // 高权重注入，这里跳过（不重复）。
        const cinematicParts = cinematicsInjected
          ? []
          : [
              sceneCinematics?.cameraAngle,
              sceneCinematics?.lighting,
              sceneCinematics?.composition,
              sceneCinematics?.colorPalette,
            ].filter((v): v is string => !!v && v.trim().length > 0);
        const composedPrompt =
          cinematicParts.length > 0
            ? `${enhancedPrompt}, ${cinematicParts.join(", ")}`
            : enhancedPrompt;

        // 迭代式生成：用户追加指令提权到 prompt 最前、声明最高优先级
        // （复用角色端 buildCharacterPromptWithCustom 的成熟提权句式）。
        // 必须拼进传给 orchestrator 的 prompt，note 才会进 enhancedPrompt→进
        // cacheKey，同一分镜换 note 不会误命中旧缓存返回旧图（缓存正确性）。
        const iterationNote = typeof note === "string" ? note.trim() : "";
        const finalPrompt = iterationNote
          ? `User instruction (highest priority, must follow): ${iterationNote}. ${composedPrompt}`
          : composedPrompt;

        // 通过编排器生成【一张】候选图（统一策略选择 + 验证 + 重试 + 上传）。
        // Stage 1.4：把客户端传入的 negativePrompt 与 referenceImage 透传给 orchestrator。
        // 客户端显式指定的 referenceImage 作为 referenceImages 列表第一项优先生效。
        const explicitRefs =
          Array.isArray(referenceImages) && referenceImages.length > 0
            ? referenceImages
            : referenceImage
              ? [referenceImage]
              : undefined;

        const generateOneCandidate = async () => {
          const result = await orchestrateImageGeneration({
            prompt: finalPrompt,
            sceneId,
            projectId,
            characters: sceneCharacters,
            shotType,
            style,
            aspectRatio,
            imageConfig: imageConfig || {
              apiKey: "",
              baseUrl: "",
              model: "",
              protocol: "openai",
            },
            llmConfig: llmConfig || undefined,
            userId: userId,
            negativePrompt: negativePrompt || undefined,
            referenceImages: explicitRefs,
            // 迭代模式：参考图是上一版整图，切换 reference_edit 为迭代友好措辞
            iterate: iterate === true,
            // 迭代一致性锚（AI 场记修复）：前镜当前图，orchestrator 按 provider 能力门控注入
            iterationAnchorUrl:
              iterate === true &&
              typeof iterationAnchorUrl === "string" &&
              iterationAnchorUrl.trim()
                ? iterationAnchorUrl.trim()
                : undefined,
            // 朝向感知三视图选择：分镜画面线索透传，orchestrator 据此挑对应朝向参考图
            sceneFacingHints: sceneFacingHints || undefined,
          });

          let candidateUrl = result.imageUrl;
          // 保存到存储服务（R2 或本地）
          if (isStorageConfigured()) {
            try {
              const fileName = `scene_${sceneId || "unknown"}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.webp`;
              candidateUrl = await uploadFileFromUrl(candidateUrl, {
                fileName,
                contentType: "image/webp",
                fileType: "image",
                userId: userId,
                projectId,
              });
            } catch (uploadError) {
              log.error(
                "Failed to save candidate, using external URL:",
                uploadError
              );
              // 降级：继续使用外部 URL
            }
          }
          return { imageUrl: candidateUrl, result };
        };

        // 多候选并行度：串行或最多 2 并发（防 provider 限流）。candidateCount=1
        // 时就是单发（零回归）。整个 run 仍占一个生成 slot，不每张单开 slot。
        type Candidate = Awaited<ReturnType<typeof generateOneCandidate>>;
        const settled: PromiseSettledResult<Candidate>[] = [];
        const CONCURRENCY = candidateCount >= 4 ? 2 : 1;
        for (let i = 0; i < candidateCount; i += CONCURRENCY) {
          const batch = Array.from(
            { length: Math.min(CONCURRENCY, candidateCount - i) },
            () => generateOneCandidate()
          );
          const batchResults = await Promise.allSettled(batch);
          settled.push(...batchResults);
        }

        const successes = settled
          .filter(
            (s): s is PromiseFulfilledResult<Candidate> =>
              s.status === "fulfilled"
          )
          .map((s) => s.value);

        // 全部失败：整单 FAILED（单张失败跳过不整单失败）
        if (successes.length === 0) {
          const firstReason = settled.find(
            (s): s is PromiseRejectedResult => s.status === "rejected"
          )?.reason;
          throw firstReason instanceof Error
            ? firstReason
            : new Error("所有候选图生成失败");
        }

        // VLM 择优：对每张成功候选打分（视觉不可用 / 打分失败静默降级为无分数）。
        // 打分上下文用分镜维度（画面描述 + 情绪 + 景别）。
        const characterDescriptions =
          sceneCharacters.length > 0
            ? sceneCharacters
                .map((c) => `${c.name}: ${c.description ?? ""}`)
                .join("\n")
            : "无角色信息";
        const scores: CandidateScore[] = await Promise.all(
          successes.map((c) =>
            scoreCandidate(
              {
                imageUrl: c.imageUrl,
                sceneDescription: sceneDescriptionForReview,
                characterDescriptions,
                expectedEmotion: sceneEmotionForReview ?? "neutral",
                expectedShotType: shotType ?? "medium shot",
              },
              llmConfig
            )
          )
        );

        // 推荐张：分数最高（无分数回落第一张）
        const recommendedIdx = pickRecommendedIndex(scores);
        const chosen = successes[recommendedIdx];
        const chosenResult = chosen.result;
        const imageUrl = chosen.imageUrl;

        // 实际成本：按【成功张数 × 单张实际成本】。单张成本沿用原逻辑
        // （编排器用了参考图则更高）；失败张天然不计（无退款路径）。
        const actualCost = successes.reduce(
          (sum, c) =>
            sum +
            (c.result.strategy === "reference_edit"
              ? IMAGE_COST.withRef
              : IMAGE_COST.normal),
          0
        );

        // R1：将「任务完成 + 场景更新 + N 条 attempt + 扣费」包进同一事务，保证原子性。
        // chargeCredits 内部会在事务里再次校验余额并记录积分流水，
        // 余额不足会抛错并自动回滚本次写入。
        // R2：扣费时机为「生成成功后」，失败张从未被扣（按成功张数计），无需退款。
        const candidatesOutput = await prisma.$transaction(async (tx) => {
          const candidates: Array<{
            attemptId: string;
            imageUrl: string;
            vlmScore: number | null;
            recommended: boolean;
          }> = [];

          // 如果有场景ID，更新场景为选中张 + 为每张候选落一条 GenerationAttempt。
          // 无 sceneId（罕见的无分镜生成）时不落 attempt（无版本历史意义），
          // 但仍返回候选（此时 attemptId 为空字符串占位，前端点选走 sceneId 分支）。
          if (projectId && sceneId) {
            await tx.scene.updateMany({
              where: { id: sceneId },
              data: { imageUrl, imageStatus: "COMPLETED" },
            });

            // 多候选：同分镜旧版本先取消 isCurrent；本次 N 张按顺序 attemptNumber 递增，
            // 仅「推荐张」置为当前版本（写 Scene.imageUrl 的那张）。
            const priorCount = await tx.generationAttempt.count({
              where: { sceneId },
            });
            await tx.generationAttempt.updateMany({
              where: { sceneId, isCurrent: true },
              data: { isCurrent: false },
            });

            for (let i = 0; i < successes.length; i++) {
              const c = successes[i];
              const isRecommended = i === recommendedIdx;
              // VLM 分数合并进 similarityScores（保留人脸校验等既有键，不整字段覆盖）
              const mergedScores = mergeSimilarityScores(
                {
                  faceCount: c.result.validation?.faceCount ?? undefined,
                },
                scores[i]
              );
              const attempt = await tx.generationAttempt.create({
                data: {
                  taskId: task.id,
                  sceneId,
                  attemptNumber: priorCount + 1 + i,
                  provider: imageConfig?.protocol ?? "unknown",
                  model: imageConfig?.model ?? "",
                  strategy: c.result.strategy,
                  referenceAssetIds: [],
                  note: iterationNote || null,
                  outputUrl: c.imageUrl,
                  similarityScores: mergedScores as Prisma.InputJsonValue,
                  passedValidation: c.result.validation?.passed ?? null,
                  faceCount: c.result.validation?.faceCount ?? null,
                  failureReason: c.result.validation?.reason || null,
                  // 推荐张即当前版本（写 Scene.imageUrl 的那张）
                  isCurrent: isRecommended,
                },
              });
              candidates.push({
                attemptId: attempt.id,
                imageUrl: c.imageUrl,
                vlmScore: scores[i].vlmScore,
                recommended: isRecommended,
              });
            }
          } else {
            // 无分镜：仅回传候选列表（无 attempt 落库）
            for (let i = 0; i < successes.length; i++) {
              candidates.push({
                attemptId: "",
                imageUrl: successes[i].imageUrl,
                vlmScore: scores[i].vlmScore,
                recommended: i === recommendedIdx,
              });
            }
          }

          // 更新任务状态：output 保持向后兼容形状 + 追加 candidates
          await tx.generationTask.update({
            where: { id: task.id },
            data: {
              status: "COMPLETED",
              output: {
                imageUrl,
                cost: actualCost,
                strategy: chosenResult.strategy,
                attemptCount: chosenResult.attemptCount,
                candidates,
              },
              completedAt: new Date(),
              cost: actualCost,
            },
          });

          // 扣减积分（按成功张数 × 单张成本，事务内扣费+记流水+余额校验）
          await chargeCredits(tx, {
            userId,
            amount: actualCost,
            type: "GENERATE_IMAGE",
            source: "generate:image",
            sourceId: task.id,
            note: sceneId
              ? `场景 ${sceneId} 图像生成（${successes.length} 张，策略 ${chosenResult.strategy}）`
              : `图像生成（${successes.length} 张，策略 ${chosenResult.strategy}）`,
          });

          return candidates;
        });

        log.info("Image candidates generated", {
          sceneId,
          count: candidateCount,
          success: successes.length,
          recommendedIdx,
          candidateCount: candidatesOutput.length,
        });
      } catch (error) {
        // 更新任务状态为失败（后台任务不再向 HTTP 层抛错，落库供轮询读取）
        await prisma.generationTask.update({
          where: { id: task.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          },
        });

        // 如果有场景ID，更新场景状态
        if (projectId && sceneId) {
          await prisma.scene.updateMany({
            where: { id: sceneId },
            data: { imageStatus: "FAILED" },
          });
        }

        log.error("Image generation task failed:", error);
      }
    };

    // 进并发闸执行（超上限排队，防单进程连接池被打爆，稳定性 P0）。
    // 兜底：run 内部 catch 自身抛错时仅记日志，残留 PROCESSING 由轮询端点
    // 的僵尸回收清扫。
    void runWithGenerationSlot(`image:${task.id}`, run).catch((err) =>
      log.error("Image task runner crashed:", err)
    );

    return NextResponse.json({ taskId: task.id, cost }, { status: 202 });
  } catch (error) {
    log.error("Image generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 }
    );
  }
}
