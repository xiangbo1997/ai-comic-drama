/**
 * POST /api/projects/[id]/continuity-check
 *
 * AI 场记（视觉连贯性体检，计划 §5 · 2.3）：VLM 逐对比对相邻已出图分镜，
 * 检查 角色服装/发型/环境背景/光线/色调 是否跳变，产出问题清单 + 综合评级。
 *
 * 异步化（对齐 three-views / location-plate）：建 task → 立即返回 taskId →
 * 后台按小并发跑各对 → 汇总报告写入 task.output → 前端轮询
 * GET /api/projects/[id]/continuity-check/[taskId]。
 *
 * 纯视觉 LLM 辅助，不扣积分（与 assist 起草 / suggest-links 路由族一致）。
 * 硬门禁：LLM 配置须支持 OpenAI 兼容多模态；不支持直接 400（不出假报告）。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserLLMConfig } from "@/lib/ai-config";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { createLogger } from "@/lib/logger";
import { parseStoryBible } from "@/types/series-bible";
import { extractSeriesPalette } from "@/lib/series";
import { getStylePaletteBaseline } from "@/lib/prompts";
import {
  compareImagePairWithVision,
  supportsVisionReview,
} from "@/services/agents/vision-reviewer";
import {
  buildPairList,
  assembleContinuityReport,
  diffContinuityReports,
  type ContinuityScene,
  type ContinuityPairResult,
  type ContinuityReport,
} from "@/services/continuity-check";
import { parseOutfitEntries } from "@/services/generation/scene-looks-match";
import type { AIServiceConfig } from "@/types";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:projects:[id]:continuity-check");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 后台逐对 VLM 调用的并发上限（对 provider 限流友好，与 novel-ingest 一致量级）
const PAIR_CONCURRENCY = 3;

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    // 限流：与 assist 路由族一致，复用图像生成的每分钟预设
    const rl = await rateLimiters.imageGeneration(request, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true, style: true, seriesId: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 取已出图分镜 + 出场角色（多角色关联表 SceneCharacter → Character.name）
    const scenes = await prisma.scene.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
      select: {
        id: true,
        order: true,
        imageUrl: true,
        locationKey: true,
        description: true,
        characterOutfits: true,
        sceneCharacters: {
          select: { character: { select: { name: true } } },
        },
      },
    });

    const continuityScenes: ContinuityScene[] = scenes.map((s) => ({
      id: s.id,
      order: s.order,
      imageUrl: s.imageUrl,
      locationKey: s.locationKey,
      characterNames: s.sceneCharacters.map((c) => c.character.name),
      description: s.description,
      outfitNotes: parseOutfitEntries(s.characterOutfits).map(
        (e) => `${e.name}：${e.outfit}`
      ),
    }));

    // 前置条件：≥2 张已出图才有对可比
    const pairs = buildPairList(continuityScenes);
    if (pairs.length === 0) {
      return NextResponse.json(
        { error: "至少需要 2 个已出图的分镜才能做连贯性体检" },
        { status: 400 }
      );
    }

    // 视觉能力硬门禁：不支持多模态直接 400，绝不出假报告
    const llmConfig = await getUserLLMConfig(userId);
    if (!llmConfig) {
      return NextResponse.json(
        { error: "请先在「设置 > AI 模型配置」中配置大语言模型" },
        { status: 400 }
      );
    }
    if (!supportsVisionReview(llmConfig)) {
      return NextResponse.json(
        { error: "当前 LLM 配置不支持视觉评审（需 OpenAI 兼容多模态）" },
        { status: 400 }
      );
    }

    // 期望色板：系列圣经 colorScript → 画风基线兜底（缺省时按无色板评色调）
    const expectedPalette = await resolveExpectedPalette(
      project.seriesId,
      project.style
    );

    // 建任务，立即返回 taskId（后台按小并发跑，绕开平台请求超时）
    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        input: { kind: "continuity_check", projectId: id, userId },
        cost: 0,
        projectId: id,
        startedAt: new Date(),
      },
    });

    void runContinuityCheckTask({
      taskId: task.id,
      projectId: id,
      pairs,
      llmConfig,
      expectedPalette,
    }).catch((err) => {
      log.error(`Background continuity-check task ${task.id} unhandled:`, err);
    });

    return NextResponse.json({ taskId: task.id, status: "PROCESSING" });
  } catch (error) {
    log.error("Continuity check error:", error);
    return NextResponse.json(
      { error: "连贯性体检失败，请稍后重试" },
      { status: 500 }
    );
  }
}

/**
 * 取项目期望色板：系列圣经 colorScript 优先，画风基线兜底。
 * 任何异常返回 undefined（色调维度按两镜相互一致性评，不阻塞体检）。
 */
async function resolveExpectedPalette(
  seriesId: string | null,
  style: string
): Promise<string | undefined> {
  try {
    if (seriesId) {
      const series = await prisma.series.findUnique({
        where: { id: seriesId },
        select: { storyBible: true },
      });
      const palette = series
        ? extractSeriesPalette(parseStoryBible(series.storyBible))
        : undefined;
      if (palette) return palette;
    }
    return getStylePaletteBaseline(style) || undefined;
  } catch (err) {
    log.warn(
      "加载期望色板失败，按无色板评色调:",
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

/**
 * 后台逐对 VLM 对比（小并发），汇总报告写回 task。不抛错。
 * 单对视觉调用失败（compareImagePairWithVision 返回 null）→ 记为 skipped，
 * 在报告 summary 中记账「N 对因视觉调用失败未检查」，不静默截断。
 */
async function runContinuityCheckTask(p: {
  taskId: string;
  projectId: string;
  pairs: ReturnType<typeof buildPairList>;
  llmConfig: AIServiceConfig;
  expectedPalette?: string;
}): Promise<void> {
  try {
    const tasks = p.pairs.map(
      (pair) => async (): Promise<ContinuityPairResult> => {
        const prevChars = pair.prev.characterNames ?? [];
        const nextChars = pair.next.characterNames ?? [];
        // 两镜共同出场的角色（服装/发型对齐对象）；无交集时给后镜角色兜底
        const commonChars = prevChars.filter((n) => nextChars.includes(n));
        const characterNames = commonChars.length > 0 ? commonChars : nextChars;

        const issues = await compareImagePairWithVision({
          prevImageUrl: pair.prev.imageUrl as string,
          nextImageUrl: pair.next.imageUrl as string,
          prevOrder: pair.prev.order + 1,
          nextOrder: pair.next.order + 1,
          prevLocationKey: pair.prev.locationKey,
          nextLocationKey: pair.next.locationKey,
          characterNames,
          expectedPalette: p.expectedPalette,
          // 剧情意图（画面描述 + 换装标注）：抑制剧情性换装/转场误报
          prevDescription: pair.prev.description,
          nextDescription: pair.next.description,
          prevOutfitNotes: pair.prev.outfitNotes,
          nextOutfitNotes: pair.next.outfitNotes,
          llmConfig: p.llmConfig,
        });

        return {
          prevSceneId: pair.prev.id,
          nextSceneId: pair.next.id,
          nextSceneOrder: pair.next.order + 1,
          skipped: issues === null,
          issues: issues ?? [],
        };
      }
    );

    const pairResults = await runWithConcurrency(tasks, PAIR_CONCURRENCY);
    const baseReport = assembleContinuityReport(pairResults);
    // 与上一轮报告对比记账（增强项）：任何异常只丢日志，绝不阻断本轮报告落库
    const report = diffContinuityReports(
      baseReport,
      await loadPreviousReport(p.projectId, p.taskId)
    );

    await prisma.generationTask.update({
      where: { id: p.taskId },
      data: {
        status: "COMPLETED",
        // report 是强类型对象，Prisma Json 入参需要 InputJsonValue（缺索引签名）
        output: { report } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    log.info(`Continuity-check task ${p.taskId} completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Continuity-check task ${p.taskId} failed:`, message);
    await prisma.generationTask
      .update({
        where: { id: p.taskId },
        data: {
          status: "FAILED",
          error: message.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch(() => {});
  }
}

/**
 * 取本项目上一轮已完成的体检报告（排除当前任务自身，按完成时间倒序取最近一份）。
 * 任何异常 / 无历史 → null（对比是增强项，绝不阻断本轮体检）。
 */
async function loadPreviousReport(
  projectId: string,
  currentTaskId: string
): Promise<ContinuityReport | null> {
  try {
    const prev = await prisma.generationTask.findFirst({
      where: {
        projectId,
        status: "COMPLETED",
        id: { not: currentTaskId },
        input: { path: ["kind"], equals: "continuity_check" },
      },
      orderBy: { completedAt: "desc" },
      select: { output: true },
    });
    const report = (prev?.output as { report?: ContinuityReport } | null)
      ?.report;
    return report && Array.isArray(report.issues) ? report : null;
  } catch (err) {
    log.warn(
      "加载上一轮体检报告失败，跳过对比记账:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * 简单并发池：以 concurrency 为上限并行执行 tasks，返回按序对齐的结果数组
 * （与 novel-ingest 的 runWithConcurrency 同构；此处内联避免跨服务耦合）。
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await tasks[current]();
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
