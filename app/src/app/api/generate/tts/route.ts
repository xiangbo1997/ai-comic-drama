import { auth } from "@/lib/auth";
import { getUserTTSConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { synthesizeSpeech } from "@/services/ai";
import { uploadToR2, isR2Configured } from "@/services/storage";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { chargeCredits } from "@/lib/credits";

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

    // 在事务闭包内 TS 会丢失对 session.user.id 的收窄，提前固化为局部常量
    const userId = session.user.id;

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
      voiceId: voiceIdFromBody,
      characterId,
      speed,
      projectId,
      sceneId,
      returnUrl = true,
      ttsConfigId,
    } = await request.json();

    /*
     * voiceId 解析顺序：
     *   1) 请求显式传入的 voiceId（最高优先级，向后兼容）；
     *   2) 根据 characterId 查 Character.voiceId（让同一角色跨场景音色稳定）；
     *   3) 兜底 "default"（由 provider 适配器各自映射到默认音色）。
     */
    let voiceId: string | undefined = voiceIdFromBody;
    if (!voiceId && typeof characterId === "string" && characterId) {
      const character = await prisma.character.findUnique({
        where: { id: characterId },
        select: { voiceId: true, userId: true },
      });
      if (
        character &&
        character.userId === session.user.id &&
        character.voiceId
      ) {
        voiceId = character.voiceId;
      }
    }
    if (!voiceId) {
      voiceId = "default";
    }

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
      const ttsConfig = await getUserTTSConfig(session.user.id, ttsConfigId);

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

      // R1：将「任务完成 + 场景更新 + 扣费」包进同一事务，保证原子性。
      // chargeCredits 内部会在事务里再次校验余额并记录积分流水，
      // 余额不足会抛错并自动回滚 task/scene 的本次写入。
      // R2：扣费时机为「生成成功后」，失败路径（catch）下用户从未被扣，无需退款。
      await prisma.$transaction(async (tx) => {
        // 更新任务状态
        await tx.generationTask.update({
          where: { id: task.id },
          data: {
            status: "COMPLETED",
            output: { audioUrl },
            completedAt: new Date(),
          },
        });

        // 如果有场景ID，更新场景
        if (projectId && sceneId && audioUrl) {
          await tx.scene.update({
            where: { id: sceneId },
            data: { audioUrl, audioStatus: "COMPLETED" },
          });
        }

        // 扣减积分（事务内扣费+记流水+余额校验）
        await chargeCredits(tx, {
          userId,
          amount: cost,
          type: "GENERATE_TTS",
          source: "generate:tts",
          sourceId: task.id,
          note: sceneId
            ? `场景 ${sceneId} 语音合成（${charCount} 字）`
            : `语音合成（${charCount} 字）`,
        });
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
