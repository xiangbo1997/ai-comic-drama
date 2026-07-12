import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { deleteFile } from "@/services/storage";

import { createLogger } from "@/lib/logger";
import { normalizeSubtitleStyle } from "@/lib/subtitle-style-normalize";
import { parseStoryBible, isBibleEmpty } from "@/types/series-bible";
const log = createLogger("api:projects:[id]");

/**
 * 删除项目后清理其分镜媒体文件（R2 或本地盘，由 storage.deleteFile 门面分派）。
 * 后台执行，失败仅记日志（孤儿文件可后续批量清理）。
 */
async function cleanupProjectMedia(
  projectId: string,
  urls: string[]
): Promise<void> {
  const results = await Promise.allSettled(urls.map((u) => deleteFile(u)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    log.warn(
      `项目 ${projectId} 删除后清理存储：${urls.length} 个文件中 ${failed} 个失败（孤儿）`
    );
  } else {
    log.info(`项目 ${projectId} 删除后清理 ${urls.length} 个媒体文件完成`);
  }
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 分镜僵尸状态惰性回收：把超时仍卡在 PROCESSING 的图/视/音状态标 FAILED。
 *
 * 背景：所有生成都同步跑在 web 请求进程里（无独立 worker），进程 rolling
 * update / OOM / 崩溃时，在途分镜的 *Status 会永久停在 PROCESSING，编辑器
 * 读到就无限转圈（reliability P0）。这里在读取项目时就地回收，复用 export
 * 那套 10 分钟阈值。以 updatedAt 作为陈旧锚点（置 PROCESSING 即更新 updatedAt）。
 *
 * 返回是否发生回收，供调用方决定是否需要重读。
 */
async function reclaimZombieScenes(projectId: string): Promise<boolean> {
  const ZOMBIE_TIMEOUT_MS = 10 * 60 * 1000;
  const cutoff = new Date(Date.now() - ZOMBIE_TIMEOUT_MS);

  // 先廉价 count 判断有无超时 PROCESSING 分镜；绝大多数 GET（项目无在途
  // 生成）到此即返回，不开写事务（a3 审计 P1-4：GET 是高频轮询端点，
  // 原每次无条件跑 3 条 updateMany 写事务，与并发生成的行锁竞争）。
  const zombieCount = await prisma.scene.count({
    where: {
      projectId,
      updatedAt: { lt: cutoff },
      OR: [
        { imageStatus: "PROCESSING" },
        { videoStatus: "PROCESSING" },
        { audioStatus: "PROCESSING" },
      ],
    },
  });
  if (zombieCount === 0) return false;

  const [img, vid, aud] = await prisma.$transaction([
    prisma.scene.updateMany({
      where: {
        projectId,
        imageStatus: "PROCESSING",
        updatedAt: { lt: cutoff },
      },
      data: { imageStatus: "FAILED" },
    }),
    prisma.scene.updateMany({
      where: {
        projectId,
        videoStatus: "PROCESSING",
        updatedAt: { lt: cutoff },
      },
      data: { videoStatus: "FAILED" },
    }),
    prisma.scene.updateMany({
      where: {
        projectId,
        audioStatus: "PROCESSING",
        updatedAt: { lt: cutoff },
      },
      data: { audioStatus: "FAILED" },
    }),
  ]);
  return img.count + vid.count + aud.count > 0;
}

// 获取单个项目详情
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 归属校验放在回收之前：先确认项目属于当前用户，避免对他人项目做写操作
    const owned = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    await reclaimZombieScenes(id);

    const project = await prisma.project.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        // 系列上下文：编辑器头部徽标 + 上下集导航 + 短剧脚本世界观预填。
        // episodes 只取轻量标识字段，量级 = 系列集数（十几条），无膨胀风险
        series: {
          select: {
            id: true,
            title: true,
            genre: true,
            worldview: true,
            protagonist: true,
            storyBible: true,
            projects: {
              orderBy: { episodeNumber: "asc" },
              select: { id: true, title: true, episodeNumber: true },
            },
          },
        },
        scenes: {
          orderBy: { order: "asc" },
          include: {
            // 窄 select：editor 只读 character 的这几个字段，原 include 全量行
            // 拉了 @db.Text description + appearance JSON + 时间戳等，payload
            // 随台词长度线性膨胀（a3 审计 P1-3）。sceneCharacters.character
            // 前端未直接消费展示，仅取轻量标识字段。
            sceneCharacters: {
              include: {
                character: {
                  select: { id: true, name: true },
                },
              },
            },
            selectedCharacter: {
              select: {
                id: true,
                name: true,
                referenceImages: true,
              },
            },
          },
        },
        // characters.character：编辑器 derivePromptInputs 消费 id/name/
        // description/referenceImages + referenceAssets(url/pose/createdAt，
        // 供三视图锁形象)。只取这些，不拉 appearance/voiceProvider 等冗余。
        characters: {
          include: {
            character: {
              select: {
                id: true,
                name: true,
                description: true,
                referenceImages: true,
                canonicalImageUrl: true,
                voiceId: true,
                referenceAssets: {
                  select: { url: true, pose: true, createdAt: true },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // series.projects → series.episodes：对齐前端 ProjectSeriesInfo 契约。
    // 故事圣经只回传编辑器需要的「摘要」（主题/未解决伏笔数/上一集钩子），
    // 不回传完整圣经（那是史官/手动编辑端的数据，前端展示用不到全量）。
    const { series, ...rest } = project;
    let bibleSummary: {
      theme: string | null;
      openThreads: number;
      episodeCount: number;
      lastEpisodeHook: string | null;
    } | null = null;
    if (series) {
      const bible = parseStoryBible(series.storyBible);
      if (!isBibleEmpty(bible)) {
        const sortedEps = [...bible.episodes].sort(
          (a, b) => a.episodeNumber - b.episodeNumber
        );
        const lastEp = sortedEps[sortedEps.length - 1];
        bibleSummary = {
          theme: bible.theme ?? null,
          openThreads: bible.threads.filter((t) => t.status === "open").length,
          episodeCount: bible.episodes.length,
          lastEpisodeHook: lastEp?.endingHook || null,
        };
      }
    }
    return NextResponse.json({
      ...rest,
      series: series
        ? {
            id: series.id,
            title: series.title,
            genre: series.genre,
            worldview: series.worldview,
            protagonist: series.protagonist,
            episodes: series.projects,
            bibleSummary,
          }
        : null,
    });
  } catch (error) {
    log.error("Get project error:", error);
    return NextResponse.json(
      { error: "Failed to get project" },
      { status: 500 }
    );
  }
}

// 更新项目
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      title,
      description,
      status,
      style,
      aspectRatio,
      inputText,
      generationParams,
      seriesId,
      episodeNumber,
    } = body;

    // 验证项目归属
    const existing = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 系列归属变更：目标系列必须存在且属于当前用户；null = 移出系列
    if (seriesId !== undefined && seriesId !== null) {
      if (typeof seriesId !== "string") {
        return NextResponse.json({ error: "seriesId 无效" }, { status: 400 });
      }
      const targetSeries = await prisma.series.findFirst({
        where: { id: seriesId, userId: session.user.id },
        select: { id: true },
      });
      if (!targetSeries) {
        return NextResponse.json({ error: "系列不存在" }, { status: 404 });
      }
    }
    const normalizedEpisodeNumber =
      episodeNumber === null
        ? null
        : typeof episodeNumber === "number" &&
            Number.isInteger(episodeNumber) &&
            episodeNumber >= 1 &&
            episodeNumber <= 9999
          ? episodeNumber
          : undefined;

    // 校验 generationParams：只接受已知字段 + 合理范围
    const normalizedGenParams =
      generationParams !== undefined
        ? normalizeGenerationParams(generationParams)
        : undefined;

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(style !== undefined && { style }),
        ...(aspectRatio !== undefined && { aspectRatio }),
        ...(inputText !== undefined && { inputText }),
        ...(normalizedGenParams !== undefined && {
          generationParams: normalizedGenParams as Prisma.InputJsonValue,
        }),
        // 移出系列时连带清空集数，避免"无系列却有第N集"的脏数据
        ...(seriesId !== undefined && {
          seriesId,
          ...(seriesId === null && { episodeNumber: null }),
        }),
        ...(normalizedEpisodeNumber !== undefined &&
          seriesId !== null && { episodeNumber: normalizedEpisodeNumber }),
      },
    });

    return NextResponse.json(project);
  } catch (error) {
    log.error("Update project error:", error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}

/**
 * 白名单 + 范围校验 generationParams，防止任意 JSON 落库。
 * 返回 Prisma 可接受的 plain object。
 */
function normalizeGenerationParams(
  input: unknown
): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof src.temperature === "number") {
    out.temperature = clampNumber(src.temperature, 0, 1.5);
  }
  if (typeof src.topP === "number") {
    out.topP = clampNumber(src.topP, 0, 1);
  }
  if (typeof src.styleStrength === "number") {
    out.styleStrength = clampNumber(src.styleStrength, 0, 1);
  }
  if (
    typeof src.negativePreset === "string" &&
    src.negativePreset.length <= 32
  ) {
    out.negativePreset = src.negativePreset;
  }
  if (
    typeof src.customNegative === "string" &&
    src.customNegative.length <= 1000
  ) {
    out.customNegative = src.customNegative;
  }
  // 字幕样式（全片统一）：校验后整体放行。白名单逻辑抽到 lib/subtitle-style-normalize
  // 便于单测（含此前漏掉的 animation 字段 + 自由默认位置 defaultX/defaultY）。
  const normalizedSubtitleStyle = normalizeSubtitleStyle(src.subtitleStyle);
  if (normalizedSubtitleStyle) {
    out.subtitleStyle = normalizedSubtitleStyle;
  }
  // 商标水印：校验后整体放行
  if (src.watermark && typeof src.watermark === "object") {
    const wm = src.watermark as Record<string, unknown>;
    const wmPos = ["tl", "tr", "bl", "br", "center"];
    out.watermark = {
      enabled: wm.enabled === true,
      imageUrl:
        typeof wm.imageUrl === "string" && wm.imageUrl.length <= 2048
          ? wm.imageUrl
          : "",
      position:
        typeof wm.position === "string" && wmPos.includes(wm.position)
          ? wm.position
          : "br",
      opacity:
        typeof wm.opacity === "number" ? clampNumber(wm.opacity, 0, 1) : 0.8,
      scale:
        typeof wm.scale === "number" ? clampNumber(wm.scale, 0.02, 0.5) : 0.12,
    };
  }
  // 贴图列表：校验每个贴图后放行（最多 50 个）
  if (Array.isArray(src.stickers)) {
    out.stickers = src.stickers
      .slice(0, 50)
      .filter(
        (st): st is Record<string, unknown> => !!st && typeof st === "object"
      )
      .map((st) => ({
        id: typeof st.id === "string" ? st.id.slice(0, 64) : "",
        imageUrl:
          typeof st.imageUrl === "string" && st.imageUrl.length <= 2048
            ? st.imageUrl
            : "",
        sceneId: typeof st.sceneId === "string" ? st.sceneId.slice(0, 64) : "",
        x: typeof st.x === "number" ? clampNumber(st.x, 0, 1) : 0.5,
        y: typeof st.y === "number" ? clampNumber(st.y, 0, 1) : 0.5,
        scale:
          typeof st.scale === "number" ? clampNumber(st.scale, 0.02, 1) : 0.2,
        ...(typeof st.startOffset === "number"
          ? { startOffset: clampNumber(st.startOffset, 0, 600) }
          : {}),
        ...(typeof st.duration === "number"
          ? { duration: clampNumber(st.duration, 0.1, 600) }
          : {}),
      }))
      .filter((st) => st.imageUrl && st.sceneId);
  }
  // 字幕逐分镜位置覆盖：校验 sceneId + 归一化坐标（最多 500 项，对应分镜数上限）
  if (Array.isArray(src.subtitlePositions)) {
    out.subtitlePositions = src.subtitlePositions
      .slice(0, 500)
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({
        sceneId: typeof p.sceneId === "string" ? p.sceneId.slice(0, 64) : "",
        x: typeof p.x === "number" ? clampNumber(p.x, 0, 1) : 0.5,
        y: typeof p.y === "number" ? clampNumber(p.y, 0, 1) : 0.88,
      }))
      .filter((p) => p.sceneId);
  }
  // 转场列表：校验每项的类型白名单 + 时长范围（与 video-synthesis XFADE_TYPES 一致）
  if (Array.isArray(src.transitions)) {
    const transitionTypes = [
      "none",
      "fade",
      "fadeblack",
      "fadewhite",
      "dissolve",
      "wipeleft",
      "wiperight",
      "wipeup",
      "wipedown",
      "slideleft",
      "slideright",
      "slideup",
      "slidedown",
      "circleopen",
      "circleclose",
      "radial",
      "smoothleft",
      "smoothright",
    ];
    out.transitions = src.transitions
      .slice(0, 200)
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({
        type:
          typeof t.type === "string" && transitionTypes.includes(t.type)
            ? t.type
            : "fade",
        duration:
          typeof t.duration === "number"
            ? clampNumber(t.duration, 0.1, 2)
            : 0.3,
      }));
  }
  // 分镜滤镜/变速：校验滤镜 id 白名单 + 变速范围（与 video-synthesis FX_FILTERS 一致）
  if (Array.isArray(src.sceneEffects)) {
    const effectIds = [
      "bw",
      "vivid",
      "sepia",
      "cold",
      "warm",
      "vignette",
      "blur",
      "oldfilm",
      "sharpen",
      "vintage",
      "tealorange",
      "dreampurple",
    ];
    out.sceneEffects = src.sceneEffects
      .slice(0, 200)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        sceneId: typeof e.sceneId === "string" ? e.sceneId.slice(0, 64) : "",
        effect:
          typeof e.effect === "string" && effectIds.includes(e.effect)
            ? e.effect
            : null,
        speed: typeof e.speed === "number" ? clampNumber(e.speed, 0.25, 4) : 1,
      }))
      .filter((e) => e.sceneId);
  }
  // 背景音乐（BGM）：校验后整体放行 —— 不加这段则前端怎么存都进不了 DB，
  // 导出永远读不到 BGM（同 ffe4928/d128149 「白存」教训）。
  if (src.backgroundMusic && typeof src.backgroundMusic === "object") {
    const bm = src.backgroundMusic as Record<string, unknown>;
    out.backgroundMusic = {
      enabled: bm.enabled === true,
      ...(typeof bm.trackId === "string" && bm.trackId.length <= 64
        ? { trackId: bm.trackId }
        : {}),
      url: typeof bm.url === "string" && bm.url.length <= 2048 ? bm.url : "",
      volume:
        typeof bm.volume === "number" ? clampNumber(bm.volume, 0, 1) : 0.25,
      fadeIn:
        typeof bm.fadeIn === "number" ? clampNumber(bm.fadeIn, 0, 10) : 1.5,
      fadeOut:
        typeof bm.fadeOut === "number" ? clampNumber(bm.fadeOut, 0, 10) : 2.0,
      loop: bm.loop !== false,
      ducking: bm.ducking === true,
    };
  }
  return out;
}

function clampNumber(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// 删除项目
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证项目归属
    const existing = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 删库前收集本项目所有分镜的媒体 URL，用于删库后清理存储。
    // 只清分镜级产物（图/视/音）——角色参考资产是跨项目共享资源（N:N），
    // 不在此删除，避免误删其它项目仍引用的角色定妆图。
    const scenes = await prisma.scene.findMany({
      where: { projectId: id },
      select: { imageUrl: true, videoUrl: true, audioUrl: true },
    });
    const mediaUrls = scenes
      .flatMap((s) => [s.imageUrl, s.videoUrl, s.audioUrl])
      .filter((u): u is string => Boolean(u));

    // GenerationTask.projectId 是无外键的 String?（不级联），删项目后 task
    // 行会残留、且其 output 里的中间产物 URL（重试图、三视图等，不在 scene
    // 三 URL 里）成永久存储孤儿（a1 P2-2）。这里一并收集并删除。
    const tasks = await prisma.generationTask.findMany({
      where: { projectId: id },
      select: { output: true },
    });
    for (const t of tasks) {
      const out = t.output as {
        imageUrl?: string;
        videoUrl?: string;
        audioUrl?: string;
      } | null;
      for (const u of [out?.imageUrl, out?.videoUrl, out?.audioUrl]) {
        if (u && typeof u === "string") mediaUrls.push(u);
      }
    }

    // 删项目 + 清项目名下 GenerationTask（无外键不会随 project.delete 级联）
    await prisma.$transaction([
      prisma.generationTask.deleteMany({ where: { projectId: id } }),
      prisma.project.delete({ where: { id } }),
    ]);

    // 存储清理：fire-and-forget，不阻塞响应；失败仅记日志（成孤儿文件，
    // 可后续批量清理），优于让用户等几十个文件逐个删完。去重后清理。
    const uniqueUrls = [...new Set(mediaUrls)];
    if (uniqueUrls.length > 0) {
      void cleanupProjectMedia(id, uniqueUrls);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete project error:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    );
  }
}
