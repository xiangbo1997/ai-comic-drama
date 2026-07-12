import { auth } from "@/lib/auth";
import { getUserVideoConfig, getUserLLMConfig } from "@/lib/ai-config";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { prisma } from "@/lib/prisma";
import { probeMediaDurationFromUrl } from "@/services/video-synthesis";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { chargeCredits } from "@/lib/credits";
import { buildVideoScenePrompt } from "@/lib/prompts";
import {
  directVideoScene,
  generateSceneVideoSegmented,
  estimateVideoCost,
  planVideoSegments,
  clampSceneDuration,
} from "@/services/generation";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import { buildPreviousEpisodeRecap } from "@/lib/series";
import { loadSeriesMemoryDigest } from "@/lib/series-memory";

import { createLogger } from "@/lib/logger";
import { runWithGenerationSlot } from "@/lib/generation-concurrency";
const log = createLogger("api:generate:video");

/**
 * 分段生成兜底超时上限（秒）。分段最多 6 段，每段生成可达数分钟；自托管 Node
 * 进程该值仅作声明式兜底（fire-and-forget 后台任务不受平台超时约束），从原
 * 300s 提到 1800s，覆盖最坏情况（6 段 × ~5min）。
 */
export const maxDuration = 1800;

/**
 * 生成时视频导演增强：服务端重建视频 prompt（LLM 导演增强 · Deliverable 2）。
 *
 * 有 sceneId + projectId 时：查分镜（全镜头字段 + actionBeat）、项目（风格 +
 * 系列前情提要）、相邻镜（order±1，仅 description+actionBeat）、出场角色
 * （name + description 作身份锚），调 directVideoScene 导演一次「运动」，再用
 * buildVideoScenePrompt 服务端重建 finalPrompt（导演产出优先，缺失回落 DB 值）。
 *
 * 重建后的 prompt 含 LLM 输出（actionBeat）必须过内容安全；不安全或链路任一步
 * 失败（无 LLM 配置 / 导演 null / 查库异常）→ 返回 null，调用方沿用客户端已
 * 安全校验过的 prompt（不改 202/task/billing 流程）。
 *
 * @returns { prompt, reason } —— prompt 为重建后已安全校验的 finalPrompt；
 *   返回 null 表示应沿用客户端 prompt（reason 供日志排障）。
 */
async function buildDirectedVideoPrompt(params: {
  userId: string;
  projectId?: string;
  sceneId?: string;
  hasLastFrame: boolean;
  duration: number;
}): Promise<{ prompt: string; reason: string } | null> {
  const { userId, projectId, sceneId, hasLastFrame, duration } = params;
  if (!projectId || !sceneId) return null;

  try {
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      select: {
        order: true,
        description: true,
        actionBeat: true,
        shotType: true,
        cameraAngle: true,
        cameraMovement: true,
        lighting: true,
        emotion: true,
        duration: true,
        selectedCharacterId: true,
        selectedCharacterIds: true,
      },
    });
    if (!scene || !scene.description?.trim()) return null;

    // 项目风格 + 系列信息（跨集前情提要的来源）
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        style: true,
        seriesId: true,
        episodeNumber: true,
        title: true,
      },
    });

    // 相邻镜（order±1，仅取 description + actionBeat 供承接/铺垫）
    const [prevScene, nextScene] = await Promise.all([
      prisma.scene.findFirst({
        where: { projectId, order: scene.order - 1 },
        select: { description: true, actionBeat: true },
      }),
      prisma.scene.findFirst({
        where: { projectId, order: scene.order + 1 },
        select: { description: true, actionBeat: true },
      }),
    ]);

    // 出场角色（name + description 作身份锚，≤200 字，仅供理解不复述）
    const characterIds =
      scene.selectedCharacterIds && scene.selectedCharacterIds.length > 0
        ? scene.selectedCharacterIds
        : scene.selectedCharacterId
          ? [scene.selectedCharacterId]
          : [];
    const dbCharacters =
      characterIds.length > 0
        ? await prisma.character.findMany({
            where: { id: { in: characterIds } },
            select: { name: true, description: true },
          })
        : [];
    const characters = dbCharacters.map((c) => ({
      name: c.name,
      identity: (c.description ?? "").slice(0, 200),
    }));

    // 跨集记忆（仅续集）：优先故事圣经 digest（stage 'scene'：角色状态 + 上一集
    // 结尾钩 + 既定场景/道具），圣经为空的老系列回落旧「上一集前情提要」。
    const seriesRecap =
      (await loadSeriesMemoryDigest(projectId, "scene")) ??
      (await deriveVideoSeriesRecap(project));

    const llmConfig = await getUserLLMConfig(userId);
    const direction = await directVideoScene(
      {
        scene: {
          description: scene.description,
          actionBeat: scene.actionBeat,
          shotType: scene.shotType,
          cameraAngle: scene.cameraAngle,
          lighting: scene.lighting,
          emotion: scene.emotion,
          duration: scene.duration,
        },
        characters,
        prevScene: prevScene ?? null,
        nextScene: nextScene ?? null,
        style: project?.style,
        seriesRecap,
      },
      llmConfig
    );
    if (!direction) return null;

    // 服务端重建：导演产出优先，缺失回落 DB 值；氛围走 atmosphereOverride
    const finalPrompt = buildVideoScenePrompt({
      description: scene.description,
      actionBeat: direction.actionBeat ?? scene.actionBeat,
      style: project?.style,
      shotType: scene.shotType,
      cameraAngle: scene.cameraAngle,
      cameraMovement: direction.cameraMovement ?? scene.cameraMovement,
      lighting: scene.lighting,
      emotion: scene.emotion,
      atmosphereOverride: direction.atmosphere,
      duration,
      hasLastFrame,
    });

    // 重建后的 prompt 含 LLM 输出（actionBeat），必须重新过内容安全
    const safety = await contentSafetyMiddleware(finalPrompt, "video");
    if (!safety.safe) {
      return null;
    }
    return {
      prompt: safety.sanitizedText || finalPrompt,
      reason: "enhanced",
    };
  } catch (err) {
    log.warn("视频导演增强链路失败，沿用客户端 prompt", {
      sceneId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 视频导演的跨集前情提要（对齐 drama-script 路由的 derivePreviousEpisodeRecap）：
 * 从上一集的 ShortDramaScript 或 Scene 结尾组装钩子。第 1 集/独立项目返回 null。
 */
async function deriveVideoSeriesRecap(
  project: {
    seriesId: string | null;
    episodeNumber: number | null;
    title: string | null;
  } | null
): Promise<string | null> {
  if (
    !project?.seriesId ||
    project.episodeNumber == null ||
    project.episodeNumber <= 1
  ) {
    return null;
  }

  const prev = await prisma.project.findFirst({
    where: {
      seriesId: project.seriesId,
      episodeNumber: { lt: project.episodeNumber },
    },
    orderBy: { episodeNumber: "desc" },
    select: { id: true, title: true, episodeNumber: true },
  });
  if (!prev) return null;

  const script = await prisma.shortDramaScript.findFirst({
    where: { projectId: prev.id },
    orderBy: { updatedAt: "desc" },
    select: { filmTitle: true, scriptDoc: true },
  });
  const doc = script?.scriptDoc as {
    logline?: unknown;
    scenes?: Array<{
      description: string;
      dialogue: string | null;
      narration: string | null;
    }>;
  } | null;
  if (doc?.scenes && doc.scenes.length > 0) {
    return buildPreviousEpisodeRecap({
      episodeNumber: prev.episodeNumber,
      title: script?.filmTitle ?? prev.title,
      logline: typeof doc.logline === "string" ? doc.logline : null,
      endingScenes: doc.scenes.slice(-2),
    });
  }

  const lastScenes = await prisma.scene.findMany({
    where: { projectId: prev.id },
    orderBy: { order: "desc" },
    take: 2,
    select: { description: true, dialogue: true, narration: true },
  });
  if (lastScenes.length === 0) return null;
  return buildPreviousEpisodeRecap({
    episodeNumber: prev.episodeNumber,
    title: prev.title,
    logline: null,
    endingScenes: [...lastScenes].reverse(),
  });
}

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
      duration: rawDuration = 5,
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

    // duration 现接受整数 1–60 秒：系统按模型能力自动分段（超过单段时长拆成 N 段
    // 无缝拼接）。越界/非数值一律钳到 [1,60]，杜绝非法值直达规划器/计费/DB。
    const duration = clampSceneDuration(rawDuration);

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

    // 提前取视频配置：分段数与计费都取决于模型能力（Veo 无视时长固定 ~8s、
    // runway/fal 接受档位），必须先知道 protocol 才能规划分段与估算成本。
    // 生成主体仍在后台 run() 里执行，此处仅用于「计费 + 分段规划」的前置决策。
    const videoConfig = await getUserVideoConfig(userId, videoConfigId);
    const capability = getVideoModelCapability(
      videoConfig?.protocol ?? "",
      videoConfig?.model
    );
    // 分段计划（决定段数与计费）；成本 = 各段档位成本之和（与客户端预览同源估算器）
    const plan = planVideoSegments(duration, capability);
    const cost = estimateVideoCost(duration, capability);

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
        // LLM 导演增强（Deliverable 2）：服务端重建带「运动 + 记忆」的 prompt。
        // 成功返回已安全校验的 finalPrompt；任一步失败/不安全返回 null，沿用
        // 客户端已安全校验过的 safePrompt。不改 202/task/billing 流程。
        const directed = await buildDirectedVideoPrompt({
          userId,
          projectId,
          sceneId,
          hasLastFrame: !!safeLastFrame,
          duration,
        });
        const finalPrompt = directed?.prompt ?? safePrompt;
        log.info("视频 prompt 路径", {
          sceneId,
          path: directed ? "enhanced" : "client_fallback",
          segments: plan.segments.length,
        });

        // 分段生成编排：时长 ≤ 单段能力时退化为一次生成（零回归）；超过时按 plan
        // 拆成 N 段链式衔接（末帧→下段首帧）+ ffmpeg 拼接成单条视频。多段路径内部
        // 已走 storage 门面落自有存储；单段路径返回 provider 临时 URL（下方转存）。
        const segResult = await generateSceneVideoSegmented({
          imageUrl,
          requestedSeconds: duration,
          capability,
          prompts: [finalPrompt],
          aspectRatio,
          referenceImages,
          identityPrompt: safeIdentityPrompt,
          lastFrameImage: safeLastFrame,
          config: videoConfig ?? undefined,
          userId,
          projectId,
          sceneId,
        });
        const isMultiSegment = segResult.segments.length > 1;
        const rawVideoUrl = segResult.videoUrl;

        // 转存到自有存储（R2 或本地盘），落库自有 URL —— 与图片生成路径一致。
        // 关键修复：provider（flow2api）返回的是内部受限域名的临时签名 URL
        // （如 https://flow-content.google/...?Expires=...）：服务器出口能下载，
        // 但用户浏览器无法解析该域名 → 预览 <video> 加载超时「视频看不了」，且
        // URL 带过期时间，过期后彻底失效。转存后浏览器用自有 URL 加载，稳定可播。
        // 转存失败降级沿用原始 URL（至少服务端导出仍可用），不阻塞生成。
        // 多段路径的 videoUrl 已是拼接后上传的自有 URL，无需再转存。
        let videoUrl = rawVideoUrl;
        if (!isMultiSegment && isStorageConfigured()) {
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
        // 请求的时长，返回 ~8s 片段，与 DB 声明时长不符。一旦分镜有了视频，
        // 视频的真实长度就是分镜时长——预览计时/导出时轴全部据此对齐（三层修复的源头）。
        // 多段路径 orchestrator 已 ffprobe 拼接后总时长，优先采用；否则用自有 URL 探测。
        let resolvedDuration = duration;
        if (
          segResult.measuredDurationSeconds &&
          segResult.measuredDurationSeconds > 0
        ) {
          resolvedDuration = Math.max(
            1,
            Math.round(segResult.measuredDurationSeconds)
          );
        } else {
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
              // 附带 duration（真实回写值）与 segments 元数据（分段排障留痕）
              output: {
                videoUrl,
                cost,
                duration: resolvedDuration,
                segments: segResult.segments,
              },
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
