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

    // 获取项目和所有分镜（含 generationParams 以读取样式配置）
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        title: true,
        aspectRatio: true,
        status: true,
        generationParams: true,
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
          scenesCount: scenesWithContent.length,
        },
        projectId: id,
      },
    });

    // 更新项目状态
    await prisma.project.update({
      where: { id },
      data: { status: "PROCESSING" },
    });

    // 准备场景数据
    const sceneMediaList = scenesWithContent.map((scene: Scene) => ({
      id: scene.id,
      order: scene.order,
      duration: scene.duration,
      imageUrl: scene.imageUrl,
      videoUrl: scene.videoUrl,
      audioUrl: scene.audioUrl,
      dialogue: scene.dialogue,
      narration: scene.narration,
    }));

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
      transitions: resolvedTransitions,
      sceneEffects: resolvedSceneEffects,
      backgroundMusic: resolvedBackgroundMusic,
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
      estimatedTime: Math.ceil(scenesWithContent.length * 5), // 估算时间（秒）
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
