import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkTextSafety } from "@/lib/content-safety";
import { getUserLLMConfig } from "@/lib/ai-config";
import { generateDramaScript } from "@/services/drama-script";
import { prisma } from "@/lib/prisma";
import { buildPreviousEpisodeRecap } from "@/lib/series";
import type { DramaScriptArtifact, DramaScriptInput } from "@/types/drama";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:drama-script");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 生成短剧脚本请求体校验
const GenerateSchema = z.object({
  worldview: z.string().trim().min(1).max(8000),
  protagonist: z.string().trim().max(2000).optional(),
  characterNames: z.array(z.string().max(100)).max(20).optional(),
  filmTitle: z.string().trim().max(200).optional(),
  genre: z.string().trim().max(100).optional(),
  durationSec: z.number().int().min(10).max(600).optional(),
  aspectRatio: z.string().max(20).optional(),
  style: z.string().max(50).optional(),
});

/**
 * POST /api/projects/[id]/drama-script
 *
 * 世界观 → 结构化短剧脚本（阶段1）。脚本生成为纯 LLM，不扣积分（鼓励创作打磨，
 * 与 /api/script/parse 一致）。异步化：建 GenerationTask → fire-and-forget →
 * 落 ShortDramaScript → 返回 taskId，前端轮询 GET /api/script/parse/[id]。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { id } = await params;

    // 项目归属校验（带系列字段：续集自动衔接前情用）
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, seriesId: true, episodeNumber: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const parsed = GenerateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求参数无效", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // 系列第 N>1 集：服务端自动生成上一集前情提要，让本集剧情承接结尾钩子
    const previousEpisodeRecap = await derivePreviousEpisodeRecap(project);
    const input: DramaScriptInput = {
      ...parsed.data,
      ...(previousEpisodeRecap ? { previousEpisodeRecap } : {}),
    };

    // 内容安全（对世界观文本审核）
    const safetyCheck = checkTextSafety(input.worldview);
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

    const llmConfig = await getUserLLMConfig(session.user.id);
    if (!llmConfig) {
      return NextResponse.json(
        { error: "请先在「设置 > AI 模型配置」中配置大语言模型" },
        { status: 400 }
      );
    }

    // 异步：建 task，立即返回 taskId（90s 生成会超 Cloudflare 100s）
    const task = await prisma.generationTask.create({
      data: {
        type: "SCRIPT_PARSE",
        status: "PROCESSING",
        input: { kind: "drama_script", projectId: id, userId: session.user.id },
        projectId: id,
        startedAt: new Date(),
      },
    });

    void runDramaScriptTask(task.id, id, input, llmConfig).catch((err) => {
      log.error(`Background drama-script task ${task.id} unhandled:`, err);
    });

    return NextResponse.json({ taskId: task.id, status: "PROCESSING" });
  } catch (error) {
    log.error("Drama script POST error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to generate drama script";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * 系列第 N>1 集：把上一集剧情压缩成前情提要（供 prompt 注入）。
 * 优先取上一集最新短剧脚本（logline + 结尾场景）；无脚本（直接文本
 * 解析路径）则以其最后两个分镜兜底。独立项目/第 1 集返回 undefined。
 */
async function derivePreviousEpisodeRecap(project: {
  seriesId: string | null;
  episodeNumber: number | null;
}): Promise<string | undefined> {
  if (
    !project.seriesId ||
    project.episodeNumber == null ||
    project.episodeNumber <= 1
  ) {
    return undefined;
  }

  const prev = await prisma.project.findFirst({
    where: {
      seriesId: project.seriesId,
      episodeNumber: { lt: project.episodeNumber },
    },
    orderBy: { episodeNumber: "desc" },
    select: { id: true, title: true, episodeNumber: true },
  });
  if (!prev) return undefined;

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
    return (
      buildPreviousEpisodeRecap({
        episodeNumber: prev.episodeNumber,
        title: script?.filmTitle ?? prev.title,
        logline: typeof doc.logline === "string" ? doc.logline : null,
        endingScenes: doc.scenes.slice(-2),
      }) ?? undefined
    );
  }

  const lastScenes = await prisma.scene.findMany({
    where: { projectId: prev.id },
    orderBy: { order: "desc" },
    take: 2,
    select: { description: true, dialogue: true, narration: true },
  });
  if (lastScenes.length === 0) return undefined;
  return (
    buildPreviousEpisodeRecap({
      episodeNumber: prev.episodeNumber,
      title: prev.title,
      logline: null,
      endingScenes: [...lastScenes].reverse(),
    }) ?? undefined
  );
}

/** 后台生成短剧脚本，落 ShortDramaScript + 写回 GenerationTask。不抛错。 */
async function runDramaScriptTask(
  taskId: string,
  projectId: string,
  input: DramaScriptInput,
  llmConfig: Awaited<ReturnType<typeof getUserLLMConfig>>
): Promise<void> {
  try {
    const artifact: DramaScriptArtifact = await generateDramaScript(
      input,
      llmConfig ?? undefined
    );

    const created = await prisma.shortDramaScript.create({
      data: {
        projectId,
        filmTitle: artifact.filmTitle,
        genre: artifact.genre,
        durationSec: artifact.durationSec,
        aspectRatio: artifact.aspectRatio,
        style: artifact.style,
        protagonist: artifact.protagonist,
        worldview: artifact.worldview,
        scriptDoc: JSON.parse(JSON.stringify(artifact)),
      },
    });

    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        output: {
          scriptId: created.id,
          ...JSON.parse(JSON.stringify(artifact)),
        },
        completedAt: new Date(),
      },
    });
    log.info(`Drama script task ${taskId} completed → script ${created.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Drama script task ${taskId} failed:`, message);
    await prisma.generationTask
      .update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          error: message.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch((updateErr) => {
        log.error(`Failed to mark task ${taskId} FAILED:`, updateErr);
      });
  }
}

/**
 * GET /api/projects/[id]/drama-script
 * 列出项目下的短剧脚本（最新在前）。
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const scripts = await prisma.shortDramaScript.findMany({
      where: { projectId: id },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({ scripts });
  } catch (error) {
    log.error("Drama script GET error:", error);
    return NextResponse.json({ error: "获取短剧脚本失败" }, { status: 500 });
  }
}
