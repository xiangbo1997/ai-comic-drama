import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Scene } from "@prisma/client";
import { synthesizeVideo, type ExportOptions } from "@/services/video-synthesis";
import { uploadToR2, isR2Configured } from "@/services/storage";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:export");

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

    // 获取项目和所有分镜
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      include: {
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
    } = await request.json();

    // 检查是否有足够的内容可以导出
    const scenesWithContent = project.scenes.filter(
      (s: Scene) => s.videoUrl || s.imageUrl
    );
    if (scenesWithContent.length === 0) {
      return NextResponse.json(
        { error: "No content to export. Please generate images or videos first." },
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

    const exportOptions: ExportOptions = {
      format: format as "mp4" | "webm",
      quality: quality as "480p" | "720p" | "1080p",
      aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
      includeSubtitles,
      includeAudio,
    };

    // 如果是同步模式，立即处理
    if (sync) {
      try {
        const videoBuffer = await synthesizeVideo(sceneMediaList, exportOptions);

        let videoUrl: string | null = null;
        if (isR2Configured()) {
          videoUrl = await uploadToR2(videoBuffer, {
            fileName: `${project.title}_export_${Date.now()}.${format}`,
            contentType: format === "mp4" ? "video/mp4" : "video/webm",
            fileType: "video",
            userId: session.user.id,
            projectId: id,
          });
        }

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
    }).catch(console.error);

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
    const videoBuffer = await synthesizeVideo(scenes, options, async (progress) => {
      // 更新进度
      await prisma.generationTask.update({
        where: { id: taskId },
        data: {
          output: { progress },
        },
      });
    });

    let videoUrl: string | null = null;
    if (isR2Configured()) {
      videoUrl = await uploadToR2(videoBuffer, {
        fileName: `${meta.projectTitle}_export_${Date.now()}.${meta.format}`,
        contentType: meta.format === "mp4" ? "video/mp4" : "video/webm",
        fileType: "video",
        userId: meta.userId,
        projectId: meta.projectId,
      });
    }

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

    const task = await prisma.generationTask.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== id) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = task.output as any;

    return NextResponse.json({
      taskId: task.id,
      status: task.status.toLowerCase(),
      progress: output?.progress ?? 0,
      videoUrl: output?.videoUrl,
      size: output?.size,
      error: task.error,
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
