/**
 * Admin Metrics API（Stage 3.6）
 *
 * GET /api/admin/metrics
 *
 * 返回：
 * - 队列状态：image/video/audio/export 每个队列的 waiting/active/completed/failed 计数
 * - 最近 workflow：近 20 条 WorkflowRun 概要（状态、耗时、所属项目）
 * - 生成统计：近 7 天的 task 统计（按 type 分组的成功/失败计数）
 *
 * 仅管理员可访问（`ADMIN_EMAILS` 白名单）；非管理员返回 404 伪装。
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import {
  imageQueue,
  videoQueue,
  audioQueue,
  exportQueue,
} from "@/services/queue";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:admin:metrics");

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 404 });
  }
  if (!isAdmin(session)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    // 各队列状态并行拉取
    const queues = [
      { name: "image", queue: imageQueue },
      { name: "video", queue: videoQueue },
      { name: "audio", queue: audioQueue },
      { name: "export", queue: exportQueue },
    ];

    const queueStats = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const [waiting, active, completed, failed, delayed] = await Promise.all(
          [
            queue.getJobs("waiting"),
            queue.getJobs("active"),
            queue.getJobs("completed"),
            queue.getJobs("failed"),
            queue.getJobs("delayed"),
          ]
        );
        return {
          name,
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
        };
      })
    );

    // 最近 workflow
    const recentWorkflows = await prisma.workflowRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        projectId: true,
        status: true,
        currentStep: true,
        error: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    // 近 7 天 task 统计
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const taskStats = await prisma.generationTask.groupBy({
      by: ["type", "status"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: true,
      _sum: { cost: true },
    });

    return NextResponse.json({
      queues: queueStats,
      recentWorkflows,
      taskStats,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error("Failed to fetch admin metrics", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
