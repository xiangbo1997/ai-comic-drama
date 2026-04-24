import { auth } from "@/lib/auth";
import { getUserTTSConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { synthesizeSpeech } from "@/services/ai";
import { uploadToR2, isR2Configured } from "@/services/storage";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:generate:tts");

// TTS 成本：每100字 2积分
const TTS_COST_PER_100_CHARS = 2;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 应用限流
    const rateLimitResult = await rateLimiters.audioGeneration(
      request,
      session.user.id
    );
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
      text,
      voiceId,
      speed,
      projectId,
      sceneId,
      returnUrl = true,
    } = await request.json();

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    // 计算成本
    const charCount = text.length;
    const cost = Math.ceil(charCount / 100) * TTS_COST_PER_100_CHARS;

    // 检查积分
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
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

    // 如果有场景ID，先更新状态为处理中
    if (projectId && sceneId) {
      await prisma.scene.update({
        where: { id: sceneId },
        data: { audioStatus: "PROCESSING" },
      });
    }

    // 创建生成任务记录
    const task = await prisma.generationTask.create({
      data: {
        type: "AUDIO_GENERATE",
        status: "PROCESSING",
        input: { text, voiceId, speed },
        projectId,
        sceneId,
        cost,
      },
    });

    try {
      // 获取用户 TTS 配置
      const ttsConfig = await getUserTTSConfig(session.user.id);

      // 调用 TTS 服务
      const audioBuffer = await synthesizeSpeech({
        text,
        voiceId,
        speed,
        config: ttsConfig ?? undefined,
      });

      let audioUrl: string | null = null;

      // 如果需要返回 URL 且 R2 已配置，上传到 R2
      if (returnUrl && isR2Configured()) {
        audioUrl = await uploadToR2(audioBuffer, {
          fileName: `tts_${Date.now()}.mp3`,
          contentType: "audio/mpeg",
          fileType: "audio",
          userId: session.user.id,
          projectId,
        });
      }

      // 更新任务状态
      await prisma.generationTask.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          output: { audioUrl },
          completedAt: new Date(),
        },
      });

      // 如果有场景ID，更新场景
      if (projectId && sceneId && audioUrl) {
        await prisma.scene.update({
          where: { id: sceneId },
          data: { audioUrl, audioStatus: "COMPLETED" },
        });
      }

      // 扣减积分
      await prisma.user.update({
        where: { id: session.user.id },
        data: { credits: { decrement: cost } },
      });

      // 如果需要返回 URL
      if (returnUrl) {
        return NextResponse.json({ audioUrl, cost, charCount });
      }

      // 否则直接返回音频数据
      return new NextResponse(new Uint8Array(audioBuffer), {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": audioBuffer.length.toString(),
        },
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

      // 如果有场景ID，更新场景状态
      if (projectId && sceneId) {
        await prisma.scene.update({
          where: { id: sceneId },
          data: { audioStatus: "FAILED" },
        });
      }

      throw error;
    }
  } catch (error) {
    log.error("TTS error:", error);
    return NextResponse.json(
      { error: "Failed to synthesize speech" },
      { status: 500 }
    );
  }
}
