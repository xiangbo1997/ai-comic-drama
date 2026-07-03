import { auth } from "@/lib/auth";
import { getUserVideoConfig } from "@/lib/ai-config";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { prisma } from "@/lib/prisma";
import { generateVideo } from "@/services/ai";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { chargeCredits } from "@/lib/credits";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:generate:video");

// 视频生成同步跑在请求处理器里，可耗时数十秒到数分钟。声明 maxDuration
// 提高平台函数超时上限，避免被默认超时（如 Vercel 10s / 边缘 100s）切断。
export const maxDuration = 300;

// 视频生成成本（积分）
const VIDEO_COST = {
  5: 10, // 5秒视频 10积分
  10: 20, // 10秒视频 20积分
  15: 30, // 15秒视频 30积分（Seedance 2.0 直出）
};

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 在事务闭包内 TS 会丢失对 session.user.id 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 应用限流
    const rateLimitResult = await rateLimiters.videoGeneration(
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
      imageUrl,
      prompt,
      duration = 5,
      aspectRatio,
      referenceImages,
      projectId,
      sceneId,
      videoConfigId,
    } = await request.json();

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Image URL is required" },
        { status: 400 }
      );
    }

    // duration 白名单：只接受 provider 支持的 5/10/15 秒档。
    // 计费按 VIDEO_COST[duration] 折算，若放任任意值（如 8），会命中 ||10 兜底
    // 却按 8s 生成，导致「扣 10 分 / 实际时长不符」的计费错配。非枚举值直接 400。
    if (![5, 10, 15].includes(duration)) {
      return NextResponse.json(
        { error: "duration 必须为 5 / 10 / 15 秒" },
        { status: 400 }
      );
    }

    // 内容安全检查（如果有提示词）
    let safePrompt = prompt;
    if (prompt) {
      const safetyCheck = await contentSafetyMiddleware(prompt, "video");
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
      safePrompt = safetyCheck.sanitizedText || prompt;
    }

    // 检查积分
    const cost = VIDEO_COST[duration as keyof typeof VIDEO_COST] || 10;
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
      await prisma.scene.update({
        where: { id: sceneId },
        data: { videoStatus: "PROCESSING" },
      });
    }

    // 创建生成任务记录
    const task = await prisma.generationTask.create({
      data: {
        type: "VIDEO_GENERATE",
        status: "PROCESSING",
        input: { imageUrl, prompt, duration },
        projectId,
        sceneId,
        cost,
      },
    });

    try {
      // 获取用户视频生成配置
      const videoConfig = await getUserVideoConfig(
        session.user.id,
        videoConfigId
      );

      // 调用视频生成服务（使用净化后的提示词）
      const videoUrl = await generateVideo({
        imageUrl,
        prompt: safePrompt,
        duration,
        aspectRatio,
        referenceImages,
        config: videoConfig ?? undefined,
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
            output: { videoUrl },
            completedAt: new Date(),
          },
        });

        // 如果有场景ID，更新场景
        if (projectId && sceneId) {
          await tx.scene.update({
            where: { id: sceneId },
            data: { videoUrl, videoStatus: "COMPLETED" },
          });
        }

        // 扣减积分（事务内扣费+记流水+余额校验）
        await chargeCredits(tx, {
          userId,
          amount: cost,
          type: "GENERATE_VIDEO",
          source: "generate:video",
          sourceId: task.id,
          note: sceneId
            ? `场景 ${sceneId} 视频生成（时长 ${duration}s）`
            : `视频生成（时长 ${duration}s）`,
        });
      });

      return NextResponse.json({ videoUrl, cost });
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
          data: { videoStatus: "FAILED" },
        });
      }

      throw error;
    }
  } catch (error) {
    log.error("Video generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate video" },
      { status: 500 }
    );
  }
}
