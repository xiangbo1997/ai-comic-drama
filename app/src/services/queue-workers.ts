/**
 * 队列任务处理器
 * 定义各类任务的处理逻辑
 */

import { createLogger } from "@/lib/logger";
import { getUserImageConfig } from "@/lib/ai-config";

const log = createLogger("queue-workers");
import { prisma } from "@/lib/prisma";
import { generateVideo, synthesizeSpeech } from "@/services/ai";
import { orchestrateImageGeneration } from "@/services/generation";
import type { SceneCharacterInfo, CharacterRole } from "@/services/generation";
import {
  synthesizeVideo,
  type ExportOptions,
} from "@/services/video-synthesis";
import { uploadToR2, isR2Configured } from "@/services/storage";
import { checkImageContent } from "@/lib/content-safety";
import {
  imageQueue,
  videoQueue,
  audioQueue,
  exportQueue,
  type JobInfo,
  type JobResult,
} from "@/services/queue";
import { handleWorkerError } from "@/services/queue-errors";

/**
 * 初始化任务处理器（Stage 2.2：分桶后每个队列独立注册）
 *
 * 可由两种方式调用：
 * - Web 进程启动时 lazy 调用（开发模式、小流量部署）
 * - 独立 worker 进程入口（生产推荐，见 app/src/workers/main.ts）
 */
export function initializeWorkers(): void {
  imageQueue.process(async (job: JobInfo): Promise<JobResult> => {
    log.info(`[image] Processing job ${job.id} of type ${job.type}`);
    if (job.type !== "image:generate") {
      return {
        success: false,
        error: `Unexpected job type on image queue: ${job.type}`,
      };
    }
    return handleImageGeneration(job);
  });

  videoQueue.process(async (job: JobInfo): Promise<JobResult> => {
    log.info(`[video] Processing job ${job.id} of type ${job.type}`);
    if (job.type !== "video:generate") {
      return {
        success: false,
        error: `Unexpected job type on video queue: ${job.type}`,
      };
    }
    return handleVideoGeneration(job);
  });

  audioQueue.process(async (job: JobInfo): Promise<JobResult> => {
    log.info(`[audio] Processing job ${job.id} of type ${job.type}`);
    if (job.type !== "audio:generate") {
      return {
        success: false,
        error: `Unexpected job type on audio queue: ${job.type}`,
      };
    }
    return handleAudioGeneration(job);
  });

  exportQueue.process(async (job: JobInfo): Promise<JobResult> => {
    log.info(`[export] Processing job ${job.id}`);
    if (job.type !== "export:video") {
      return { success: false, error: `Unexpected export type: ${job.type}` };
    }
    return handleVideoExport(job);
  });

  log.info("Queue workers initialized (image/video/audio/export)");
}

/**
 * 处理图像生成任务
 */
async function handleImageGeneration(job: JobInfo): Promise<JobResult> {
  const { prompt, aspectRatio, style } = job.data.payload as {
    prompt: string;
    referenceImage?: string;
    aspectRatio?: "1:1" | "9:16" | "16:9";
    style?: string;
  };

  try {
    // 更新场景状态
    if (job.data.sceneId) {
      await prisma.scene.update({
        where: { id: job.data.sceneId },
        data: { imageStatus: "PROCESSING" },
      });
    }

    // 更新任务记录
    await prisma.generationTask.updateMany({
      where: {
        sceneId: job.data.sceneId,
        type: "IMAGE_GENERATE",
        status: "PENDING",
      },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });

    // 获取用户图像生成配置
    const imageConfig = await getUserImageConfig(job.data.userId);

    // 获取场景角色信息
    let sceneCharacters: SceneCharacterInfo[] = [];
    let shotType: string | undefined;

    if (job.data.sceneId) {
      const scene = await prisma.scene.findUnique({
        where: { id: job.data.sceneId },
        select: {
          shotType: true,
          selectedCharacterIds: true,
          selectedCharacter: {
            select: {
              id: true,
              name: true,
              gender: true,
              age: true,
              description: true,
              referenceImages: true,
              appearance: true,
            },
          },
        },
      });

      shotType = scene?.shotType || undefined;

      const buildChar = (
        c: {
          id: string;
          name: string;
          gender: string | null;
          age: string | null;
          description: string | null;
          referenceImages: string[];
          appearance?: Record<string, unknown> | null;
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
        canonicalImageUrl: (c.referenceImages as string[])?.[0],
        appearance: c.appearance as SceneCharacterInfo["appearance"],
      });

      if ((scene?.selectedCharacterIds?.length ?? 0) > 0) {
        const dbChars = await prisma.character.findMany({
          where: { id: { in: scene!.selectedCharacterIds } },
          select: {
            id: true,
            name: true,
            gender: true,
            age: true,
            description: true,
            referenceImages: true,
            appearance: true,
          },
        });
        sceneCharacters = dbChars.map((c, i) => buildChar(c, i));
      } else if (scene?.selectedCharacter) {
        sceneCharacters = [buildChar(scene.selectedCharacter, 0)];
      }
    }

    // 通过编排器生成图像
    const result = await orchestrateImageGeneration({
      prompt,
      sceneId: job.data.sceneId,
      projectId: job.data.projectId,
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
      userId: job.data.userId,
    });

    const imageUrl = result.imageUrl;

    // 内容安全检查（生成后）
    const safetyCheck = await checkImageContent(imageUrl);
    if (!safetyCheck.safe) {
      throw new Error(`图片内容审核未通过: ${safetyCheck.reason}`);
    }

    // 更新场景
    if (job.data.sceneId) {
      await prisma.scene.update({
        where: { id: job.data.sceneId },
        data: { imageUrl, imageStatus: "COMPLETED" },
      });
    }

    // 更新任务记录
    const cost = result.strategy === "reference_edit" ? 3 : 1;
    await prisma.generationTask.updateMany({
      where: {
        sceneId: job.data.sceneId,
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
      },
      data: {
        status: "COMPLETED",
        output: {
          imageUrl,
          strategy: result.strategy,
          attemptCount: result.attemptCount,
        },
        completedAt: new Date(),
      },
    });

    // 扣减积分
    await prisma.user.update({
      where: { id: job.data.userId },
      data: { credits: { decrement: cost } },
    });

    return {
      success: true,
      data: { imageUrl, cost, strategy: result.strategy },
    };
  } catch (error) {
    return handleWorkerError(error, async (cat) => {
      if (job.data.sceneId) {
        await prisma.scene.update({
          where: { id: job.data.sceneId },
          data: { imageStatus: "FAILED" },
        });
      }
      await prisma.generationTask.updateMany({
        where: {
          sceneId: job.data.sceneId,
          type: "IMAGE_GENERATE",
          status: "PROCESSING",
        },
        data: {
          status: "FAILED",
          error: cat.message,
          completedAt: new Date(),
        },
      });
      log.warn(`Image job ${job.id} failed (${cat.category})`, {
        retryable: cat.retryable,
        message: cat.message,
      });
    });
  }
}

/**
 * 处理视频生成任务
 */
async function handleVideoGeneration(job: JobInfo): Promise<JobResult> {
  const { imageUrl, duration } = job.data.payload as {
    imageUrl: string;
    duration: 5 | 10;
  };

  try {
    // 更新场景状态
    if (job.data.sceneId) {
      await prisma.scene.update({
        where: { id: job.data.sceneId },
        data: { videoStatus: "PROCESSING" },
      });
    }

    // 调用视频生成服务
    const videoUrl = await generateVideo({
      imageUrl,
      duration,
    });

    // 更新场景
    if (job.data.sceneId) {
      await prisma.scene.update({
        where: { id: job.data.sceneId },
        data: { videoUrl, videoStatus: "COMPLETED" },
      });
    }

    // 扣减积分（10积分/5秒）
    const cost = Math.ceil(duration / 5) * 10;
    await prisma.user.update({
      where: { id: job.data.userId },
      data: { credits: { decrement: cost } },
    });

    return { success: true, data: { videoUrl, cost } };
  } catch (error) {
    // Stage 2.3：分级处理。可重试错误 throw 让 BullMQ 退避重试；不可重试则落盘失败。
    return handleWorkerError(error, async (cat) => {
      if (job.data.sceneId) {
        await prisma.scene.update({
          where: { id: job.data.sceneId },
          data: { videoStatus: "FAILED" },
        });
      }
      log.warn(`Video job ${job.id} failed (${cat.category})`, {
        retryable: cat.retryable,
        message: cat.message,
      });
    });
  }
}

/**
 * 处理音频生成任务
 */
async function handleAudioGeneration(job: JobInfo): Promise<JobResult> {
  const { text, voiceId, speed } = job.data.payload as {
    text: string;
    voiceId?: string;
    speed?: number;
  };

  try {
    // 更新场景状态
    if (job.data.sceneId) {
      await prisma.scene.update({
        where: { id: job.data.sceneId },
        data: { audioStatus: "PROCESSING" },
      });
    }

    // 调用TTS服务
    const audioBuffer = await synthesizeSpeech({
      text,
      voiceId,
      speed,
    });

    // 上传到存储
    let audioUrl: string | null = null;
    if (isR2Configured()) {
      audioUrl = await uploadToR2(audioBuffer, {
        fileName: `tts_${job.id}_${Date.now()}.mp3`,
        contentType: "audio/mpeg",
        fileType: "audio",
        userId: job.data.userId,
        projectId: job.data.projectId,
      });
    }

    // 更新场景
    if (job.data.sceneId && audioUrl) {
      await prisma.scene.update({
        where: { id: job.data.sceneId },
        data: { audioUrl, audioStatus: "COMPLETED" },
      });
    }

    // 扣减积分（2积分/100字）
    const cost = Math.ceil(text.length / 100) * 2;
    await prisma.user.update({
      where: { id: job.data.userId },
      data: { credits: { decrement: cost } },
    });

    return { success: true, data: { audioUrl, cost } };
  } catch (error) {
    return handleWorkerError(error, async (cat) => {
      if (job.data.sceneId) {
        await prisma.scene.update({
          where: { id: job.data.sceneId },
          data: { audioStatus: "FAILED" },
        });
      }
      log.warn(`Audio job ${job.id} failed (${cat.category})`, {
        retryable: cat.retryable,
        message: cat.message,
      });
    });
  }
}

/**
 * 处理视频导出任务
 */
async function handleVideoExport(job: JobInfo): Promise<JobResult> {
  const { projectId, format, quality, includeSubtitles, includeAudio } = job
    .data.payload as {
    projectId: string;
    format: string;
    quality: string;
    includeSubtitles: boolean;
    includeAudio: boolean;
  };

  try {
    // 获取项目和场景
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        scenes: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    // 更新项目状态
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "PROCESSING" },
    });

    // 准备场景数据
    const scenesWithContent = project.scenes.filter(
      (s) => s.videoUrl || s.imageUrl
    );

    if (scenesWithContent.length === 0) {
      throw new Error("No content to export");
    }

    const sceneMediaList = scenesWithContent.map((scene) => ({
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

    // 合成视频
    const videoBuffer = await synthesizeVideo(sceneMediaList, exportOptions);

    // 上传到存储
    let videoUrl: string | null = null;
    if (isR2Configured()) {
      videoUrl = await uploadToR2(videoBuffer, {
        fileName: `${project.title}_export_${Date.now()}.${format}`,
        contentType: format === "mp4" ? "video/mp4" : "video/webm",
        fileType: "video",
        userId: job.data.userId,
        projectId,
      });
    }

    // 更新项目状态
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "COMPLETED" },
    });

    // 更新任务记录
    await prisma.generationTask.updateMany({
      where: {
        projectId,
        type: "EXPORT",
        status: "PROCESSING",
      },
      data: {
        status: "COMPLETED",
        output: { videoUrl, size: videoBuffer.length },
        completedAt: new Date(),
      },
    });

    return {
      success: true,
      data: { videoUrl, size: videoBuffer.length },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // 更新项目状态为失败
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "FAILED" },
    });

    // 更新任务记录
    await prisma.generationTask.updateMany({
      where: {
        projectId,
        type: "EXPORT",
        status: "PROCESSING",
      },
      data: {
        status: "FAILED",
        error: errorMessage,
        completedAt: new Date(),
      },
    });

    return { success: false, error: errorMessage };
  }
}
