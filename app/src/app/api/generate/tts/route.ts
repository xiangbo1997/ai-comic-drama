import { auth } from "@/lib/auth";
import { getUserTTSConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { synthesizeSpeech } from "@/services/ai";
import { uploadFile } from "@/services/storage";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { chargeCredits } from "@/lib/credits";

import { createLogger } from "@/lib/logger";
import { runWithGenerationSlot } from "@/lib/generation-concurrency";
const log = createLogger("api:generate:tts");

// TTS 成本：每100字 2积分
const TTS_COST_PER_100_CHARS = 2;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 在事务闭包内 TS 会丢失对 userId 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 应用限流
    const rateLimitResult = await rateLimiters.audioGeneration(request, userId);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    // 注：原 returnUrl=false（直接返回音频 buffer）分支随异步化移除——
    // 全代码库无调用方使用；异步模式统一落盘后经轮询返回 audioUrl。
    const {
      text,
      voiceId: voiceIdFromBody,
      characterId,
      speed,
      projectId,
      sceneId,
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
      if (character && character.userId === userId && character.voiceId) {
        voiceId = character.voiceId;
      }
    }
    if (!voiceId) {
      voiceId = "default";
    }

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    // 文本长度上限：单次合成最多 5000 字。无上限时超大文本会送 provider 并
    // 落盘，既放大成本又占资源（与 script/parse 的 10000 字拦截同类防护）。
    const TTS_MAX_CHARS = 5000;
    if (typeof text !== "string" || text.length > TTS_MAX_CHARS) {
      return NextResponse.json(
        { error: `配音文本过长（最多 ${TTS_MAX_CHARS} 字）` },
        { status: 400 }
      );
    }

    // 计算成本
    const charCount = text.length;
    const cost = Math.ceil(charCount / 100) * TTS_COST_PER_100_CHARS;

    // 检查积分
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

    // IDOR 防护：校验 sceneId 归属当前用户（security-cost P0-1）
    if (sceneId) {
      const ownsScene = await prisma.scene.findFirst({
        where: { id: sceneId, project: { userId } },
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
        data: { audioStatus: "PROCESSING" },
      });
    }

    // 创建生成任务记录（input.userId 供轮询端点做归属校验，同 script/parse 模式）
    const task = await prisma.generationTask.create({
      data: {
        type: "AUDIO_GENERATE",
        status: "PROCESSING",
        input: { userId, text, voiceId, speed },
        projectId,
        sceneId,
        cost,
      },
    });

    // 异步化（2026-07-04）：合成主体 fire-and-forget 后台执行，POST 立即
    // 返回 taskId，客户端轮询 GET /api/generate/tasks/[taskId] 取结果。
    // 扣费语义不变：成功后事务内扣费。
    const run = async () => {
      try {
        // 获取用户 TTS 配置
        const ttsConfig = await getUserTTSConfig(userId, ttsConfigId);

        // 调用 TTS 服务
        const audioBuffer = await synthesizeSpeech({
          text,
          voiceId,
          speed,
          config: ttsConfig ?? undefined,
        });

        // 落盘：走 uploadFile 统一门面（R2 已配走云存储 / 未配降级本地盘
        // public/uploads），不再因缺 R2 而丢弃音频致哑片。
        const audioUrl = await uploadFile(audioBuffer, {
          fileName: `tts_${Date.now()}.mp3`,
          contentType: "audio/mpeg",
          fileType: "audio",
          userId,
          projectId,
        });

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
              // output 即轮询端点透传给客户端的 result，保持与原同步响应同形
              output: { audioUrl, cost, charCount },
              completedAt: new Date(),
            },
          });

          // 如果有场景ID，更新场景
          if (projectId && sceneId && audioUrl) {
            await tx.scene.updateMany({
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
            data: { audioStatus: "FAILED" },
          });
        }

        log.error("TTS task failed:", error);
      }
    };

    // 进并发闸执行（同 video/image，防单进程连接池被打爆）
    void runWithGenerationSlot(`tts:${task.id}`, run).catch((err) =>
      log.error("TTS task runner crashed:", err)
    );

    return NextResponse.json(
      { taskId: task.id, cost, charCount },
      {
        status: 202,
      }
    );
  } catch (error) {
    log.error("TTS error:", error);
    return NextResponse.json(
      { error: "Failed to synthesize speech" },
      { status: 500 }
    );
  }
}
