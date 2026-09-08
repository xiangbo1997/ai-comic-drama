/**
 * Admin Metrics API（保留兼容）
 *
 * GET /api/admin/metrics
 *
 * 原始的仪表盘数据源。仪表盘已改用 `/api/admin/dashboard`（一次聚合出用户 /
 * 积分 / 收入 / 生成成功率等全部首屏指标），本端点保留原有契约不变，供尚未
 * 迁移的调用方与外部脚本使用。
 *
 * 保留而非删除的理由：这是个已发布的只读端点，删掉会静默打断外部拨测脚本；
 * 它的两个查询也正是 dashboard 端点的子集，维护成本接近于零。
 *
 * 仅管理员可访问（`User.role` 为 ADMIN/SUPER_ADMIN）；非管理员返回 404 伪装。
 */

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { daysAgo } from "@/lib/admin-dashboard";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:metrics");

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  try {
    const [recentWorkflows, taskStats] = await Promise.all([
      prisma.workflowRun.findMany({
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
      }),
      prisma.generationTask.groupBy({
        by: ["type", "status"],
        where: { createdAt: { gte: daysAgo(7) } },
        _count: true,
        _sum: { cost: true },
      }),
    ]);

    return NextResponse.json({
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
