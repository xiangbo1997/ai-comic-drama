import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Scene } from "@prisma/client";
import {
  synthesizeVideo,
  type ExportOptions,
} from "@/services/video-synthesis";
import { uploadFile } from "@/services/storage";
import {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_WATERMARK,
  type SubtitleStyle,
  type Watermark,
} from "@/types/export-style";
import { resolveLutPreset, type ColorGrade } from "@/lib/color-grade";
import {
  buildTitleCards,
  TITLE_CARD_SCENE_ID,
  END_CARD_SCENE_ID,
  type TitleCardsConfig,
} from "@/lib/title-cards";
import { parseStoryBible } from "@/types/series-bible";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:export");

// 导出走 FFmpeg 合成，可耗时数分钟。声明 maxDuration 提高平台函数超时上限
// （异步分支已有轮询兜底，此处覆盖 sync 分支与首个请求）。
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 导出项目视频
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 获取项目和所有分镜（含 generationParams 以读取样式配置）。
    // seriesId/episodeNumber + series.storyBible 供片头/片尾卡（批6）：
    // 系列项目默认开双卡，片尾钩子文案取本集在圣经里的 endingHook。
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        title: true,
        aspectRatio: true,
        status: true,
        generationParams: true,
        seriesId: true,
        episodeNumber: true,
        series: {
          select: { storyBible: true },
        },
        scenes: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const {
      format = "mp4",
      quality = "720p",
      includeSubtitles = true,
      includeAudio = true,
      sync = false, // 是否同步处理（默认异步）
      // 可选：由前端直接覆盖样式，优先级高于 generationParams
      subtitleStyle: bodySubtitleStyle,
      watermark: bodyWatermark,
      // 批6：调色 / 片头尾卡的 body 覆盖（与 subtitleStyle 同优先级模式）
      colorGrade: bodyColorGrade,
      titleCard: bodyTitleCard,
      endCard: bodyEndCard,
    } = await request.json();

    // 从 generationParams 中解析样式配置（兼容旧项目：缺失时使用默认值）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const genParams = (project.generationParams as Record<string, any>) ?? {};
    const resolvedSubtitleStyle: SubtitleStyle = {
      ...DEFAULT_SUBTITLE_STYLE,
      ...(genParams.subtitleStyle ?? {}),
      ...(bodySubtitleStyle ?? {}),
    };
    const resolvedWatermark: Watermark = {
      ...DEFAULT_WATERMARK,
      ...(genParams.watermark ?? {}),
      ...(bodyWatermark ?? {}),
    };
    // 贴图列表（仅从 generationParams 读取，无 body 覆盖）
    const resolvedStickers = Array.isArray(genParams.stickers)
      ? genParams.stickers
      : [];
    // 字幕逐分镜位置覆盖（仅从 generationParams 读取）：缺省时合成端
    // 按 subtitleStyle.position 全局默认定位，保持与旧项目一致。
    const resolvedSubtitlePositions = Array.isArray(genParams.subtitlePositions)
      ? genParams.subtitlePositions
      : undefined;
    // 转场配置 / 分镜画面调节（滤镜+变速）：从 generationParams 读取，
    // 缺省时 video-synthesis 自动回退默认行为（fade 0.3s / 不加滤镜变速）。
    const resolvedTransitions = Array.isArray(genParams.transitions)
      ? genParams.transitions
      : undefined;
    const resolvedSceneEffects = Array.isArray(genParams.sceneEffects)
      ? genParams.sceneEffects
      : undefined;
    // 背景音乐（BGM）：从 generationParams 读取，缺省/未启用时合成端不混入。
    const resolvedBackgroundMusic =
      genParams.backgroundMusic && typeof genParams.backgroundMusic === "object"
        ? genParams.backgroundMusic
        : undefined;
    // 音效（SFX，批1）：从 generationParams 读取，缺省时合成端零音效（存量零回归）。
    const resolvedSfx = Array.isArray(genParams.sfx)
      ? genParams.sfx
      : undefined;
    // 金句花字（批6）：从 generationParams 读取金句分镜 id 列表，缺省时无花字（存量零回归）。
    const resolvedEmphasis = Array.isArray(genParams.emphasis)
      ? (genParams.emphasis as string[])
      : undefined;
    // 全片 LUT 调色（批6）：body 可覆盖（与 subtitleStyle 同优先级），二者都缺省时不调色。
    // enabled 严格布尔 + lutId 白名单校验（非法/缺省不启用，绝不注入任意路径到 ffmpeg）。
    const rawColorGrade = (
      bodyColorGrade && typeof bodyColorGrade === "object"
        ? bodyColorGrade
        : genParams.colorGrade && typeof genParams.colorGrade === "object"
          ? genParams.colorGrade
          : null
    ) as { enabled?: unknown; lutId?: unknown } | null;
    let resolvedColorGrade: ColorGrade | undefined;
    if (
      rawColorGrade &&
      rawColorGrade.enabled === true &&
      typeof rawColorGrade.lutId === "string" &&
      resolveLutPreset(rawColorGrade.lutId)
    ) {
      resolvedColorGrade = {
        enabled: true,
        lutId: rawColorGrade.lutId as ColorGrade["lutId"],
      };
    }

    // 检查是否有足够的内容可以导出
    const scenesWithContent = project.scenes.filter(
      (s: Scene) => s.videoUrl || s.imageUrl
    );
    if (scenesWithContent.length === 0) {
      return NextResponse.json(
        {
          error:
            "No content to export. Please generate images or videos first.",
        },
        { status: 400 }
      );
    }

    // ── 片头/片尾卡（批6 成片包装）─────────────────────────────────────
    // 系列项目默认开双卡（片头建品牌 + 片尾钩追更）；非系列默认关。
    // body 的 titleCard/endCard 布尔覆盖 > generationParams.titleCards > 缺省契约。
    const isSeries = !!project.seriesId;
    const rawTitleCards =
      genParams.titleCards && typeof genParams.titleCards === "object"
        ? (genParams.titleCards as TitleCardsConfig)
        : null;
    // body 覆盖优先（仅当为 boolean 时生效），否则用已存配置。
    // 缺省契约（系列默认开、非系列默认关）由 buildTitleCards 内部
    // resolveTitleCardsEnabled(config, isSeries) 统一解析，这里不重复判断。
    const titleCardsConfig: TitleCardsConfig = {
      title:
        typeof bodyTitleCard === "boolean"
          ? bodyTitleCard
          : rawTitleCards?.title,
      end: typeof bodyEndCard === "boolean" ? bodyEndCard : rawTitleCards?.end,
    };

    // 片尾钩子文案：系列项目取本集在故事圣经里的 endingHook；取不到 → null
    // （buildTitleCards 会给通用追更文案）。用 parseStoryBible 容错解析，永不抛错。
    let hookText: string | null = null;
    if (
      project.series?.storyBible &&
      typeof project.episodeNumber === "number"
    ) {
      const bible = parseStoryBible(project.series.storyBible);
      const ep = bible.episodes.find(
        (e) => e.episodeNumber === project.episodeNumber
      );
      hookText = ep?.endingHook?.trim() ? ep.endingHook : null;
    }

    // 卡片底图：片头取首个有图分镜、片尾取末个有图分镜（卡片是普通图片分镜，
    // 底图自带 Ken Burns 缓推）。全片无图时对应卡跳过（下方 buildTitleCards 后判 null）。
    const scenesWithImage = scenesWithContent.filter((s: Scene) => s.imageUrl);
    const coverImageUrl = scenesWithImage[0]?.imageUrl ?? null;
    const endImageUrl =
      scenesWithImage[scenesWithImage.length - 1]?.imageUrl ?? null;

    const { intro, outro } = buildTitleCards({
      projectTitle: project.title,
      episodeNumber: project.episodeNumber,
      hookText,
      coverImageUrl,
      endImageUrl,
      config: titleCardsConfig,
      isSeries,
    });

    // 准备场景数据（正片分镜）
    const baseSceneMediaList = scenesWithContent.map((scene: Scene) => ({
      id: scene.id,
      order: scene.order,
      duration: scene.duration,
      imageUrl: scene.imageUrl,
      videoUrl: scene.videoUrl,
      audioUrl: scene.audioUrl,
      dialogue: scene.dialogue,
      narration: scene.narration,
      card: null as {
        kind: "title" | "end";
        lines: { text: string; role: "title" | "sub" | "hook" | "cta" }[];
      } | null,
    }));

    // 注入片头/片尾卡合成分镜（底图非 null 才注入；全片无图则跳过并告警）。
    // order：片头卡 -1（排最前），片尾卡 = 现有最大 order + 1（排最后）。
    const sceneMediaList = [...baseSceneMediaList];
    const maxOrder = baseSceneMediaList.reduce(
      (m, s) => Math.max(m, s.order),
      -1
    );
    // 记录实际注入了几张卡，供转场位移与任务估算对齐
    let introInjected = false;
    let outroInjected = false;
    if (intro) {
      if (intro.imageUrl) {
        sceneMediaList.unshift({
          id: TITLE_CARD_SCENE_ID,
          order: -1,
          duration: intro.durationSec,
          imageUrl: intro.imageUrl,
          videoUrl: null,
          audioUrl: null,
          dialogue: null,
          narration: null,
          card: { kind: intro.kind, lines: intro.lines },
        });
        introInjected = true;
      } else {
        log.warn(`项目 ${id} 片头卡因全片无图跳过`);
      }
    }
    if (outro) {
      if (outro.imageUrl) {
        sceneMediaList.push({
          id: END_CARD_SCENE_ID,
          order: maxOrder + 1,
          duration: outro.durationSec,
          imageUrl: outro.imageUrl,
          videoUrl: null,
          audioUrl: null,
          dialogue: null,
          narration: null,
          card: { kind: outro.kind, lines: outro.lines },
        });
        outroInjected = true;
      } else {
        log.warn(`项目 ${id} 片尾卡因全片无图跳过`);
      }
    }

    // 转场索引位移（批6）：options.transitions 是「第 k 项 = 第 k 与 k+1 镜之间」
    // 的索引对齐数组。注入片头卡后须在最前 unshift 一项（片头卡与首镜之间），
    // 注入片尾卡后须在末尾 push 一项（末镜与片尾卡之间）——仅当 resolvedTransitions
    // 已是数组时才做；为 undefined 时保持 undefined（全片默认硬切含卡片边界，零回归）。
    let resolvedTransitionsWithCards = resolvedTransitions;
    if (Array.isArray(resolvedTransitionsWithCards)) {
      const cardTransition = { type: "fadeblack", duration: 0.3 };
      resolvedTransitionsWithCards = [...resolvedTransitionsWithCards];
      if (introInjected) {
        resolvedTransitionsWithCards.unshift({ ...cardTransition });
      }
      if (outroInjected) {
        resolvedTransitionsWithCards.push({ ...cardTransition });
      }
    }

    // 卡片数计入任务统计（scenesCount + estimatedTime）
    const cardCount = (introInjected ? 1 : 0) + (outroInjected ? 1 : 0);

    // 创建导出任务
    const task = await prisma.generationTask.create({
      data: {
        type: "EXPORT",
        status: "PROCESSING",
        input: {
          projectId: id,
          format,
          quality,
          includeSubtitles,
          includeAudio,
          scenesCount: scenesWithContent.length + cardCount,
        },
        projectId: id,
      },
    });

    // 更新项目状态
    await prisma.project.update({
      where: { id },
      data: { status: "PROCESSING" },
    });

    // subtitleStyle / watermark 字段已由 video-synthesis 的 ExportOptions 显式声明，
    // 使用类型注解而非断言，确保字段被真正类型检查。
    const exportOptions: ExportOptions = {
      format: format as "mp4" | "webm",
      quality: quality as "480p" | "720p" | "1080p",
      aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
      includeSubtitles,
      includeAudio,
      subtitleStyle: resolvedSubtitleStyle,
      subtitlePositions: resolvedSubtitlePositions,
      watermark: resolvedWatermark,
      stickers: resolvedStickers,
      // 已含片头/片尾卡边界转场位移（批6）
      transitions: resolvedTransitionsWithCards,
      sceneEffects: resolvedSceneEffects,
      backgroundMusic: resolvedBackgroundMusic,
      sfx: resolvedSfx,
      emphasisSceneIds: resolvedEmphasis,
      colorGrade: resolvedColorGrade,
    };

    // 如果是同步模式，立即处理
    if (sync) {
      try {
        const videoBuffer = await synthesizeVideo(
          sceneMediaList,
          exportOptions
        );

        // R2 已配走云存储，未配自动降级本地盘（public/uploads），
        // 不再因缺 R2 而丢弃合成产物导致导出"无产物"。
        const videoUrl = await uploadFile(videoBuffer, {
          fileName: `${project.title}_export_${Date.now()}.${format}`,
          contentType: format === "mp4" ? "video/mp4" : "video/webm",
          fileType: "video",
          userId: session.user.id,
          projectId: id,
        });

        // 更新任务状态
        await prisma.generationTask.update({
          where: { id: task.id },
          data: {
            status: "COMPLETED",
            output: { videoUrl, size: videoBuffer.length },
            completedAt: new Date(),
          },
        });

        // 更新项目状态
        await prisma.project.update({
          where: { id },
          data: { status: "COMPLETED" },
        });

        return NextResponse.json({
          taskId: task.id,
          status: "completed",
          videoUrl,
          size: videoBuffer.length,
        });
      } catch (error) {
        // 更新任务状态为失败
        await prisma.generationTask.update({
          where: { id: task.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          },
        });

        // 更新项目状态
        await prisma.project.update({
          where: { id },
          data: { status: "FAILED" },
        });

        throw error;
      }
    }

    // 异步模式：启动后台任务
    // 注意：在生产环境中应使用任务队列（如 Inngest、BullMQ）
    // 这里简化处理，返回任务 ID 让前端轮询
    processExportAsync(task.id, sceneMediaList, exportOptions, {
      projectId: id,
      userId: session.user.id,
      projectTitle: project.title,
      format,
    }).catch((err) => log.error("后台导出任务失败:", err));

    return NextResponse.json({
      taskId: task.id,
      status: "processing",
      message: "Export task created. Video synthesis in progress.",
      // 估算时间（秒）：正片分镜 + 片头/片尾卡各计一片段
      estimatedTime: Math.ceil((scenesWithContent.length + cardCount) * 5),
    });
  } catch (error) {
    log.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to start export" },
      { status: 500 }
    );
  }
}

// 异步处理导出任务
async function processExportAsync(
  taskId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scenes: any[],
  options: ExportOptions,
  meta: {
    projectId: string;
    userId: string;
    projectTitle: string;
    format: string;
  }
) {
  try {
    const videoBuffer = await synthesizeVideo(
      scenes,
      options,
      async (progress) => {
        // 更新进度
        await prisma.generationTask.update({
          where: { id: taskId },
          data: {
            output: { progress },
          },
        });
      }
    );

    // R2 已配走云存储，未配自动降级本地盘（public/uploads），
    // 与同步分支一致，确保导出始终产出可访问的 videoUrl。
    const videoUrl = await uploadFile(videoBuffer, {
      fileName: `${meta.projectTitle}_export_${Date.now()}.${meta.format}`,
      contentType: meta.format === "mp4" ? "video/mp4" : "video/webm",
      fileType: "video",
      userId: meta.userId,
      projectId: meta.projectId,
    });

    // 更新任务状态
    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        output: { videoUrl, size: videoBuffer.length, progress: 100 },
        completedAt: new Date(),
      },
    });

    // 更新项目状态
    await prisma.project.update({
      where: { id: meta.projectId },
      data: { status: "COMPLETED" },
    });
  } catch (error) {
    log.error("Export async error:", error);

    // 更新任务状态为失败
    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      },
    });

    // 更新项目状态
    await prisma.project.update({
      where: { id: meta.projectId },
      data: { status: "FAILED" },
    });
  }
}

// 获取导出任务状态
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json({ error: "Task ID required" }, { status: 400 });
    }

    // 校验项目归属（GenerationTask 无 project 外键关系，故先验 project）
    const ownsProject = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!ownsProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const task = await prisma.generationTask.findFirst({
      where: { id: taskId, projectId: id },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // 僵尸任务惰性回收：PROCESSING 但超过 10 分钟未结束（多半是进程重启
    // 丢了在途任务），就地标 FAILED，避免前端无限轮询永远转圈
    // （reliability P0-1）。
    const ZOMBIE_TIMEOUT_MS = 10 * 60 * 1000;
    let effectiveStatus = task.status;
    let effectiveError = task.error;
    if (
      task.status === "PROCESSING" &&
      Date.now() - task.createdAt.getTime() > ZOMBIE_TIMEOUT_MS
    ) {
      await prisma.generationTask.update({
        where: { id: task.id },
        data: {
          status: "FAILED",
          error: "导出任务超时（可能因服务重启中断）",
          completedAt: new Date(),
        },
      });
      effectiveStatus = "FAILED";
      effectiveError = "导出任务超时（可能因服务重启中断）";
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = task.output as any;

    return NextResponse.json({
      taskId: task.id,
      status: effectiveStatus.toLowerCase(),
      progress: output?.progress ?? 0,
      videoUrl: output?.videoUrl,
      size: output?.size,
      error: effectiveError,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    });
  } catch (error) {
    log.error("Get export status error:", error);
    return NextResponse.json(
      { error: "Failed to get export status" },
      { status: 500 }
    );
  }
}
