/**
 * 数据生命周期清理端点（2026-07-05，a8 审计 P2-1/P2-2）
 *
 * POST /api/admin/cleanup
 *
 * 单节点部署无 cron，由外部定时器（系统 crontab / 云函数定时触发）周期性
 * 打此端点执行清理。做三件事：
 *   ① 删除 30 天前已终结（COMPLETED/FAILED）的 GenerationTask + WorkflowRun
 *      ——两表每次生成/轮询/workflow 都写、从不删除，日活稍大即月增数十万行，
 *        拖慢 admin/metrics 的 groupBy 全表扫。
 *   ② 过期未支付订单（PENDING 且 createdAt 超 24h）置 EXPIRED
 *      ——订单无支付超时机制，PENDING 会永久堆积。
 *   ③ 主动回收僵尸：updatedAt 超阈值仍 PROCESSING 的 GenerationTask + 关联
 *      Scene，以及 RUNNING 的 WorkflowRun，置 FAILED。此前僵尸回收全是「惰性」
 *      （只在有人轮询时触发），关页面的任务永久 PROCESSING → 分镜永久「生成中」
 *        假状态、无法重试。这里不依赖轮询主动扫。
 *
 * 鉴权：管理员 session（ADMIN_EMAILS）或 x-cron-secret 头匹配 CRON_SECRET
 * （供无 session 的定时器使用）。两者都不满足返回 404 伪装。
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:admin:cleanup");

// 终结任务保留期：30 天前的 COMPLETED/FAILED 可删（审计/展示已无意义）
const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// 未支付订单过期期：下单 24h 未支付视为放弃
const ORDER_EXPIRE_MS = 24 * 60 * 60 * 1000;
// 僵尸阈值：15 分钟无更新仍 PROCESSING/RUNNING 视为已死（同轮询端点阈值）
const ZOMBIE_MS = 15 * 60 * 1000;

async function authorize(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");
  if (secret && provided && provided === secret) return true;
  const session = await auth();
  return isAdmin(session);
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const now = Date.now();
    const taskCutoff = new Date(now - TASK_RETENTION_MS);
    const orderCutoff = new Date(now - ORDER_EXPIRE_MS);
    const zombieCutoff = new Date(now - ZOMBIE_MS);

    // ① 删终结的老 task / workflow
    const [deletedTasks, deletedWorkflows] = await prisma.$transaction([
      prisma.generationTask.deleteMany({
        where: {
          status: { in: ["COMPLETED", "FAILED"] },
          updatedAt: { lt: taskCutoff },
        },
      }),
      prisma.workflowRun.deleteMany({
        where: {
          status: { in: ["COMPLETED", "FAILED"] },
          updatedAt: { lt: taskCutoff },
        },
      }),
    ]);

    // ② 过期未支付订单置 EXPIRED
    const expiredOrders = await prisma.order.updateMany({
      where: { status: "PENDING", createdAt: { lt: orderCutoff } },
      data: { status: "EXPIRED" },
    });

    // ③ 主动回收僵尸：GenerationTask + 关联 Scene 三态 + WorkflowRun
    const zombieTasks = await prisma.generationTask.findMany({
      where: { status: "PROCESSING", updatedAt: { lt: zombieCutoff } },
      select: { id: true, type: true, sceneId: true },
    });
    const sceneField: Record<
      string,
      "imageStatus" | "videoStatus" | "audioStatus"
    > = {
      IMAGE_GENERATE: "imageStatus",
      VIDEO_GENERATE: "videoStatus",
      AUDIO_GENERATE: "audioStatus",
    };
    for (const t of zombieTasks) {
      const field = sceneField[t.type];
      await prisma.$transaction([
        prisma.generationTask.update({
          where: { id: t.id },
          data: {
            status: "FAILED",
            error: "任务超时未完成（定时清理回收）",
            completedAt: new Date(),
          },
        }),
        ...(t.sceneId && field
          ? [
              prisma.scene.updateMany({
                where: { id: t.sceneId },
                data: { [field]: "FAILED" },
              }),
            ]
          : []),
      ]);
    }

    const zombieWorkflows = await prisma.workflowRun.updateMany({
      where: { status: "RUNNING", updatedAt: { lt: zombieCutoff } },
      data: { status: "FAILED", error: "任务超时未完成（定时清理回收）" },
    });

    const summary = {
      deletedTasks: deletedTasks.count,
      deletedWorkflows: deletedWorkflows.count,
      expiredOrders: expiredOrders.count,
      recycledZombieTasks: zombieTasks.length,
      recycledZombieWorkflows: zombieWorkflows.count,
    };
    log.info("Cleanup completed", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    log.error("Cleanup failed:", error);
    return NextResponse.json({ error: "清理失败" }, { status: 500 });
  }
}
