import { auth } from "@/lib/auth";
import { getUserVideoConfig } from "@/lib/ai-config";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { prisma } from "@/lib/prisma";
import { generateVideo } from "@/services/ai";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:generate:video");

// 视频生成成本（积分）
const VIDEO_COST = {
  5: 10,  // 5秒视频 10积分
  10: 20, // 10秒视频 20积分
};

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 应用限流
    const rateLimitResult = await rateLimiters.videoGeneration(request, session.user.id);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    const { imageUrl, prompt, duration = 5, projectId, sceneId } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: "Image URL is required" }, { status: 400 });
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
            blockedKeywords: safetyCheck.blockedKeywords
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
        { error: "Insufficient credits", required: cost, current: user?.credits ?? 0 },
        { status: 400 }
      );
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
      const videoConfig = await getUserVideoConfig(session.user.id);

      // 调用视频生成服务（使用净化后的提示词）
      const videoUrl = await generateVideo({
        imageUrl,
        prompt: safePrompt,
        duration,
        config: videoConfig ?? undefined,
      });

      // 更新任务状态
      await prisma.generationTask.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          output: { videoUrl },
          completedAt: new Date(),
        },
      });

      // 如果有场景ID，更新场景
      if (projectId && sceneId) {
        await prisma.scene.update({
          where: { id: sceneId },
          data: { videoUrl, videoStatus: "COMPLETED" },
        });
      }

      // 扣减积分
      await prisma.user.update({
        where: { id: session.user.id },
        data: { credits: { decrement: cost } },
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
