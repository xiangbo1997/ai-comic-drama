import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkTextSafety } from "@/lib/content-safety";
import { getUserLLMConfig } from "@/lib/ai-config";
import { generateDramaScript } from "@/services/drama-script";
import {
  derivePreviousEpisodeRecap,
  readStoredGenre,
} from "@/services/drama-script-context";
import { prisma } from "@/lib/prisma";
import { chronicleEpisode } from "@/services/series/chronicler";
import type { DramaScriptArtifact, DramaScriptInput } from "@/types/drama";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:drama-script");

// 脚本生成为长文本 LLM 调用（8K maxTokens，实测上游需 130-180 秒）。
// 虽为 fire-and-forget + 任务轮询，仍声明 maxDuration 兜底，与 export 路由一致。
export const maxDuration = 300;

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

    // 项目归属校验（带系列字段：续集自动衔接前情用；带 generationParams：读题材）
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        seriesId: true,
        episodeNumber: true,
        generationParams: true,
      },
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
    // 题材（批 3）：客户端显式传入优先；未传则回落项目已存的 generationParams.genre。
    // 回落在服务端做而非各前端调用点做——否则新增一个调用方就漏一次题材注入
    // （编辑器脚本面板、制片人向导、系列续集三条路径都靠这一处收口）。
    const genre = parsed.data.genre?.trim() || readStoredGenre(project);
    const input: DramaScriptInput = {
      ...parsed.data,
      ...(genre ? { genre } : {}),
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

    void runDramaScriptTask(task.id, id, input, llmConfig, {
      userId: session.user.id,
      seriesId: project.seriesId,
      episodeNumber: project.episodeNumber,
    }).catch((err) => {
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

/** 后台生成短剧脚本，落 ShortDramaScript + 写回 GenerationTask。不抛错。 */
async function runDramaScriptTask(
  taskId: string,
  projectId: string,
  input: DramaScriptInput,
  llmConfig: Awaited<ReturnType<typeof getUserLLMConfig>>,
  series: {
    userId: string;
    seriesId: string | null;
    episodeNumber: number | null;
  }
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

    // 系列集：脚本定稿后 fire-and-forget 归档进故事圣经（跨集记忆增量更新）。
    // 静默失败，不回写 task 状态、不影响已交付的脚本。
    if (series.seriesId && series.episodeNumber != null) {
      void chronicleEpisode({
        seriesId: series.seriesId,
        projectId,
        episodeNumber: series.episodeNumber,
        userId: series.userId,
      }).catch((chronicleErr) => {
        log.warn(`Drama script task ${taskId} 归档失败（脚本已交付）`, {
          error:
            chronicleErr instanceof Error
              ? chronicleErr.message
              : String(chronicleErr),
        });
      });
    }
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
