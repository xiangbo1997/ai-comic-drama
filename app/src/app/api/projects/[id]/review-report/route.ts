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
 * （见 continuity-check/route.ts）。用 Prisma PostgreSQL JSON path 过滤在 DB 层直接
 * 命中 kind=continuity_check 的行（避免普通出图任务把这一行挤出取样窗口——旧实现
 * take:20 后在 JS 里扫，一轮 20+ 次出图就会把场记结果冲掉，误报「尚未运行」）。
 * 从未运行 / 结果缺失 → 返回 null（对应节报「尚未运行 AI 场记体检」）。
 *
 * grade 兼容三态：
 * - 字符串 A/B/C/D：正常评级；
 * - null（新契约）：体检跑过但无一对成功检查（视觉调用全失败）→ 传 null 给报告，
 *   报告节报「场记体检未完成」告警（不同于「尚未运行」，也不当作通过）；
 * - 老数据无 checkedPairs 字段时按字符串 grade 走正常分支（向后兼容）。
 */
async function loadLatestContinuitySummary(
  projectId: string,
  userId: string
): Promise<ContinuitySummaryInput | null> {
  const task = await prisma.generationTask.findFirst({
    where: {
      projectId,
      type: "IMAGE_GENERATE",
      status: "COMPLETED",
      // DB 层 JSON path 过滤：只命中场记任务，不被普通出图任务挤出窗口
      input: { path: ["kind"], equals: "continuity_check" },
    },
    orderBy: { completedAt: "desc" },
    select: { input: true, output: true },
  });

  if (!task) return null;

  const input = (task.input ?? {}) as { userId?: string };
  // 归属兜底：任务 input 记了 userId 时须与当前用户一致
  if (input.userId && input.userId !== userId) return null;

  const output = (task.output ?? {}) as {
    report?: {
      grade?: unknown;
      summary?: unknown;
      issues?: unknown;
      checkedPairs?: unknown;
    };
  };
  const report = output.report;
  if (!report || typeof report !== "object") return null;

  const summary = typeof report.summary === "string" ? report.summary : "";
  if (!summary) return null;
  const issueCount = Array.isArray(report.issues) ? report.issues.length : 0;

  // 体检未完成：grade 显式为 null，或新契约下 checkedPairs=0（无一对成功检查）。
  const checkedPairs =
    typeof report.checkedPairs === "number" ? report.checkedPairs : undefined;
  if (report.grade === null || checkedPairs === 0) {
    return { grade: null, summary, issueCount: 0 };
  }

  // 正常评级（含老数据：无 checkedPairs 字段，按字符串 grade 走）
  const grade = typeof report.grade === "string" ? report.grade : "";
  if (!grade) return null;
  return { grade, summary, issueCount };
}
