/**
 * 后台仪表盘聚合端点
 *
 * GET /api/admin/dashboard
 *
 * 一次请求回全部首屏指标：用户 / 积分 / 收入 / 生成成功率 / workflow /
 * 最近 workflow。刻意做成**单端点聚合**而不是让页面并发打六个小端点——
 * 首屏 30 秒轮询一次，六个端点意味着每分钟 12 次鉴权往返（`requireAdmin`
 * 每次都回库读 role），而这些查询本身互不依赖，`Promise.all` 一轮就够。
 *
 * 所有计数走 `count/aggregate/groupBy`，不拉行——用户表和流水表会长到百万级，
 * 任何 `findMany` 全量再在 JS 里数都是定时炸弹。
 *
 * 仅管理员可访问；非管理员由 requireAdmin 返回 404 伪装。
 */

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import {
  daysAgo,
  summarizeGenerationStats,
  truncateText,
  type TaskStatusCount,
} from "@/lib/admin-dashboard";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:dashboard");

// 每次都要读实时数据，禁止被静态化
export const dynamic = "force-dynamic";

/** 最近 workflow 列表条数（与旧 metrics 端点保持一致） */
const RECENT_WORKFLOW_LIMIT = 20;
/** 最近失败列表条数：面板只做「有没有在冒烟」的提示，深挖去日志 */
const RECENT_FAILURE_LIMIT = 10;

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  try {
    const now = new Date();
    const since7d = daysAgo(7, now);
    const since30d = daysAgo(30, now);

    const [
      totalUsers,
      newUsers7d,
      activeUsers7d,
      bannedUsers,
      creditBalance,
      granted7d,
      charged7d,
      paidOrders30d,
      taskStatusRows,
      processingNow,
      runningWorkflows,
      failedWorkflows7d,
      recentWorkflows,
      recentFailures,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: since7d } } }),
      prisma.user.count({ where: { status: "BANNED" } }),
      prisma.user.aggregate({ _sum: { credits: true } }),
      // 发放 = delta 为正；扣减 = delta 为负。两侧分开聚合而不是求净值，
      // 净值会把「发了很多也扣了很多」压成 0，掩盖真实吞吐量。
      prisma.creditTransaction.aggregate({
        _sum: { delta: true },
        where: { createdAt: { gte: since7d }, delta: { gt: 0 } },
      }),
      prisma.creditTransaction.aggregate({
        _sum: { delta: true },
        where: { createdAt: { gte: since7d }, delta: { lt: 0 } },
      }),
      // 收入口径：按 paidAt 而非 createdAt——30 天前下单、昨天付款的钱算昨天的
      prisma.order.aggregate({
        _count: true,
        _sum: { amount: true },
        where: { status: "PAID", paidAt: { gte: since30d } },
      }),
      prisma.generationTask.groupBy({
        by: ["type", "status"],
        where: { createdAt: { gte: since7d } },
        _count: true,
      }),
      prisma.generationTask.count({ where: { status: "PROCESSING" } }),
      prisma.workflowRun.count({ where: { status: "RUNNING" } }),
      prisma.workflowRun.count({
        where: { status: "FAILED", updatedAt: { gte: since7d } },
      }),
      prisma.workflowRun.findMany({
        orderBy: { createdAt: "desc" },
        take: RECENT_WORKFLOW_LIMIT,
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
      prisma.generationTask.findMany({
        where: { status: "FAILED", updatedAt: { gte: since7d } },
        orderBy: { updatedAt: "desc" },
        take: RECENT_FAILURE_LIMIT,
        select: {
          id: true,
          type: true,
          error: true,
          projectId: true,
          sceneId: true,
          updatedAt: true,
        },
      }),
    ]);

    const statusCounts: TaskStatusCount[] = taskStatusRows.map((row) => ({
      type: row.type,
      status: row.status,
      count: row._count,
    }));

    // Decimal 不能直接进 JSON（序列化成对象），统一转 number。金额是两位小数
    // 的人民币元，Number 精度足够；真要做财务对账应当回库用 Decimal 算。
    const paidAmount30d = paidOrders30d._sum.amount
      ? Number(paidOrders30d._sum.amount)
      : 0;

    return NextResponse.json({
      users: {
        total: totalUsers,
        new7d: newUsers7d,
        active7d: activeUsers7d,
        banned: bannedUsers,
      },
      credits: {
        totalBalance: creditBalance._sum.credits ?? 0,
        granted7d: granted7d._sum.delta ?? 0,
        // 扣减侧 delta 为负，取绝对值让前端直接展示「消耗了多少」
        charged7d: Math.abs(charged7d._sum.delta ?? 0),
      },
      revenue: {
        paidOrders30d: paidOrders30d._count,
        paidAmount30d,
      },
      generation: {
        last7d: summarizeGenerationStats(statusCounts),
        processingNow,
      },
      workflows: {
        running: runningWorkflows,
        failed7d: failedWorkflows7d,
      },
      recentWorkflows: recentWorkflows.map((w) => ({
        ...w,
        error: truncateText(w.error),
      })),
      recentFailures: recentFailures.map((t) => ({
        ...t,
        error: truncateText(t.error),
      })),
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    log.error("加载仪表盘指标失败:", error);
    return NextResponse.json({ error: "加载仪表盘指标失败" }, { status: 500 });
  }
}
