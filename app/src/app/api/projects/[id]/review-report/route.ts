/**
 * GET /api/projects/[id]/review-report
 *
 * 全片审片报告（计划 §6 · 3.2）：导出前的确定性体检——时长节奏 / 结尾钩子 /
 * 连贯性（复用 2.3 结果）/ 素材完整性，附可跳转到对应分镜的修改建议清单。
 *
 * 完全确定性：不调 LLM、不扣积分、同步返回（够轻，无需 task 模式）。
 * 数据源：分镜（Scene）+ 最新 ShortDramaScript 的 hookType + 最近一次已完成的
 * continuity_check 任务摘要。任一数据缺失都不报错——对应节降级为「未标注/未运行」。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { HOOK_TYPES, type HookType } from "@/types/series-bible";
import {
  assembleReviewReport,
  type ReviewScene,
  type ContinuitySummaryInput,
} from "@/lib/review-report";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:projects:[id]:review-report");

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    // 项目归属校验
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    // 分镜（按 order 升序；只取审片需要的字段）
    const scenes = await prisma.scene.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
      select: {
        id: true,
        order: true,
        duration: true,
        shotType: true,
        dialogue: true,
        narration: true,
        imageUrl: true,
        videoUrl: true,
        audioUrl: true,
        videoLinkNext: true,
      },
    });
    const reviewScenes: ReviewScene[] = scenes.map((s) => ({
      id: s.id,
      order: s.order,
      duration: s.duration,
      shotType: s.shotType,
      dialogue: s.dialogue,
      narration: s.narration,
      imageUrl: s.imageUrl,
      videoUrl: s.videoUrl,
      audioUrl: s.audioUrl,
      videoLinkNext: s.videoLinkNext,
    }));

    const [hookType, continuitySummary] = await Promise.all([
      loadLatestHookType(id),
      loadLatestContinuitySummary(id, userId),
    ]);

    const report = assembleReviewReport({
      scenes: reviewScenes,
      hookType,
      continuitySummary,
    });

    return NextResponse.json({ report });
  } catch (error) {
    log.error("Review report error:", error);
    return NextResponse.json(
      { error: "生成审片报告失败，请稍后重试" },
      { status: 500 }
    );
  }
}

/**
 * 取最新短剧脚本的结尾钩子类型。
 * hookType 存在 scriptDoc（整个 DramaScriptArtifact JSON）顶层；
 * 解析型项目 / LLM 漏填 / 老数据 → 返回 null（对应节报「未标注」）。
 */
async function loadLatestHookType(projectId: string): Promise<HookType | null> {
  const script = await prisma.shortDramaScript.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: { scriptDoc: true },
  });
  if (!script?.scriptDoc || typeof script.scriptDoc !== "object") return null;
  const doc = script.scriptDoc as { hookType?: unknown };
  const raw = doc.hookType;
  return typeof raw === "string" &&
    (HOOK_TYPES as readonly string[]).includes(raw)
    ? (raw as HookType)
    : null;
}

/**
 * 取最近一次「已完成」的 AI 场记（continuity_check）任务摘要。
 *
 * continuity_check 任务落库为 type=IMAGE_GENERATE + input.kind="continuity_check"
 * （见 continuity-check/route.ts）；Prisma 对嵌套 JSON 过滤不便，故查项目近期
 * 已完成的 IMAGE_GENERATE 任务、按时间倒序，在 JS 里挑第一个 kind 匹配的。
 * 从未运行 / 结果缺失 → 返回 null（对应节报「尚未运行 AI 场记体检」）。
 */
async function loadLatestContinuitySummary(
  projectId: string,
  userId: string
): Promise<ContinuitySummaryInput | null> {
  const tasks = await prisma.generationTask.findMany({
    where: { projectId, type: "IMAGE_GENERATE", status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 20,
    select: { input: true, output: true },
  });

  for (const task of tasks) {
    const input = (task.input ?? {}) as { kind?: string; userId?: string };
    if (input.kind !== "continuity_check") continue;
    // 归属兜底：任务 input 记了 userId 时须与当前用户一致
    if (input.userId && input.userId !== userId) continue;

    const output = (task.output ?? {}) as {
      report?: { grade?: unknown; summary?: unknown; issues?: unknown };
    };
    const report = output.report;
    if (!report || typeof report !== "object") continue;

    const grade = typeof report.grade === "string" ? report.grade : "";
    const summary = typeof report.summary === "string" ? report.summary : "";
    const issueCount = Array.isArray(report.issues) ? report.issues.length : 0;
    if (!grade || !summary) continue;

    return { grade, summary, issueCount };
  }
  return null;
}
