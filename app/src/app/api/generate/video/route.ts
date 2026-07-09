import { auth } from "@/lib/auth";
import { getUserVideoConfig } from "@/lib/ai-config";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { prisma } from "@/lib/prisma";
import { generateVideo } from "@/services/ai";
import { probeMediaDurationFromUrl } from "@/services/video-synthesis";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { chargeCredits } from "@/lib/credits";

import { createLogger } from "@/lib/logger";
import { runWithGenerationSlot } from "@/lib/generation-concurrency";
const log = createLogger("api:generate:video");

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

    // 在事务闭包内 TS 会丢失对 userId 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 应用限流
    const rateLimitResult = await rateLimiters.videoGeneration(request, userId);
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
      identityPrompt,
      lastFrameImage,
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

    // 身份前缀（角色 DNA，视频人物一致性锚）同样过内容安全：
    // 可净化则用净化文本；不可净化时降级丢弃（视频仍可生成，仅损失一致性），
    // 不用 400 阻断——否则存量角色描述含边缘词会让原本能跑的生成突然失败。
    let safeIdentityPrompt: string | undefined;
    if (typeof identityPrompt === "string" && identityPrompt.trim()) {
      const identityCheck = await contentSafetyMiddleware(
        identityPrompt,
        "video"
      );
      if (identityCheck.safe) {
        safeIdentityPrompt = identityCheck.sanitizedText || identityPrompt;
      } else {
        log.warn("identityPrompt 未通过内容安全，已丢弃", {
          reason: identityCheck.reason,
        });
      }
    }

    // 尾帧图（首尾帧衔接，通常=下一分镜图片）：仅接受非空字符串
    const safeLastFrame =
      typeof lastFrameImage === "string" && lastFrameImage
        ? lastFrameImage
        : undefined;

    // 检查积分
    const cost = VIDEO_COST[duration as keyof typeof VIDEO_COST] || 10;
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
        data: { videoStatus: "PROCESSING" },
      });
    }

    // 创建生成任务记录（input.userId 供轮询端点做归属校验，同 script/parse 模式）
    const task = await prisma.generationTask.create({
      data: {
        type: "VIDEO_GENERATE",
        status: "PROCESSING",
        input: {
          userId,
          imageUrl,
          prompt,
          duration,
          // 排障留痕：尾帧衔接与身份前缀是否生效（identityPrompt ≤200 字）
          lastFrameImage: safeLastFrame ?? null,
          identityPrompt: safeIdentityPrompt ?? null,
        },
        projectId,
        sceneId,
        cost,
      },
    });

    // 异步化（2026-07-04）：生成主体 fire-and-forget 后台执行，POST 立即
    // 返回 taskId，客户端轮询 GET /api/generate/tasks/[taskId] 取结果。
    // 视频是最长的同步等待（可达数分钟），异步化后不再受平台超时约束、
    // 页面刷新也不丢任务。扣费语义不变：成功后事务内扣费。
    const run = async () => {
      try {
        // 获取用户视频生成配置
        const videoConfig = await getUserVideoConfig(userId, videoConfigId);

        // 调用视频生成服务（使用净化后的提示词）
        const rawVideoUrl = await generateVideo({
          imageUrl,
          prompt: safePrompt,
          duration,
          aspectRatio,
          referenceImages,
          identityPrompt: safeIdentityPrompt,
          lastFrameImage: safeLastFrame,
          config: videoConfig ?? undefined,
        });

        // 转存到自有存储（R2 或本地盘），落库自有 URL —— 与图片生成路径一致。
        // 关键修复：provider（flow2api）返回的是内部受限域名的临时签名 URL
        // （如 https://flow-content.google/...?Expires=...）：服务器出口能下载，
        // 但用户浏览器无法解析该域名 → 预览 <video> 加载超时「视频看不了」，且
        // URL 带过期时间，过期后彻底失效。转存后浏览器用自有 URL 加载，稳定可播。
        // 转存失败降级沿用原始 URL（至少服务端导出仍可用），不阻塞生成。
        let videoUrl = rawVideoUrl;
        if (isStorageConfigured()) {
          try {
            videoUrl = await uploadFileFromUrl(rawVideoUrl, {
              fileName: `scene_${sceneId || "unknown"}_${Date.now()}.mp4`,
              contentType: "video/mp4",
              fileType: "video",
              userId,
              projectId,
            });
            log.info("Video saved to storage:", videoUrl);
          } catch (uploadError) {
            log.error("视频转存存储失败，降级沿用外部 URL:", uploadError);
          }
        }

        // 探测视频真实时长回写 Scene.duration：provider（flow2api/Veo）常忽略
        // 请求的 5/10/15s，返回 ~8s 片段，与 DB 声明时长不符。一旦分镜有了视频，
        // 视频的真实长度就是分镜时长——预览计时/导出时轴全部据此对齐（三层修复的源头）。
        // 用转存后的自有 URL 探测（本地盘直读/自有域名可达），探测失败回退请求时长。
        let resolvedDuration = duration;
        try {
          const probed = await probeMediaDurationFromUrl(videoUrl);
          if (probed > 0) {
            resolvedDuration = Math.max(1, Math.round(probed));
          }
        } catch (probeErr) {
          log.warn("视频真实时长探测失败，回退请求时长", {
            duration,
            error: probeErr instanceof Error ? probeErr.message : probeErr,
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
              // output 即轮询端点透传给客户端的 result，保持与原同步响应同形；
              // 附带 duration 供排障/客户端使用（真实回写值）
              output: { videoUrl, cost, duration: resolvedDuration },
              completedAt: new Date(),
            },
          });

          // 如果有场景ID，更新场景（同步真实时长：视频真实长度即分镜时长）
          if (projectId && sceneId) {
            await tx.scene.updateMany({
              where: { id: sceneId },
              data: {
                videoUrl,
                videoStatus: "COMPLETED",
                duration: resolvedDuration,
              },
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
            data: { videoStatus: "FAILED" },
          });
        }

        log.error("Video generation task failed:", error);
      }
    };

    // 进并发闸执行：超出全局上限时排队，避免 N 用户齐发批量把单进程连接池
    // 打爆（稳定性 P0）。POST 仍立即 202 返回，run 在后台排队/执行。
    void runWithGenerationSlot(`video:${task.id}`, run).catch((err) =>
      log.error("Video task runner crashed:", err)
    );

    return NextResponse.json({ taskId: task.id, cost }, { status: 202 });
  } catch (error) {
    log.error("Video generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate video" },
      { status: 500 }
    );
  }
}
