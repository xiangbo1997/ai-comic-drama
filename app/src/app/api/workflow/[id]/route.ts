/**
 * Workflow [id] API — 获取状态 / 取消
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  getWorkflowStatus,
  cancelWorkflow,
} from "@/services/agents/workflow-engine";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:workflow:id");

/** GET /api/workflow/[id] — 获取 workflow 详细状态 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // 验证归属
    const run = await prisma.workflowRun.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!run) {
      return NextResponse.json({ error: "Workflow 不存在" }, { status: 404 });
    }

    // 惰性回收僵尸 run：workflow 是 fire-and-forget 挂在 web 进程上，
    // 进程重启后 RUNNING/PENDING 无人改写，前端将永远显示"运行中"。
    // 引擎每个步骤都会 update run 行（updatedAt 即活性锚），超过阈值
    // 无任何步进即视为已死（与分镜/导出的僵尸回收同思路）。
    const WORKFLOW_ZOMBIE_MS = 60 * 60 * 1000; // 1 小时
    if (
      (run.status === "RUNNING" || run.status === "PENDING") &&
      Date.now() - run.updatedAt.getTime() > WORKFLOW_ZOMBIE_MS
    ) {
      await prisma.workflowRun.update({
        where: { id },
        data: {
          status: "FAILED",
          error: "任务已中断（服务重启或长时间无响应），请重新发起",
          completedAt: new Date(),
        },
      });
      log.warn(`Recycled zombie workflow run ${id}`);
    }

    const status = await getWorkflowStatus(id);
    return NextResponse.json(status);
  } catch (error) {
    log.error("Get workflow status error:", error);
    return NextResponse.json(
      { error: "获取 workflow 状态失败" },
      { status: 500 }
    );
  }
}

/** DELETE /api/workflow/[id] — 取消 workflow */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const run = await prisma.workflowRun.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!run) {
      return NextResponse.json({ error: "Workflow 不存在" }, { status: 404 });
    }

    if (run.status === "COMPLETED" || run.status === "FAILED") {
      return NextResponse.json(
        { error: "Workflow 已结束，无法取消" },
        { status: 400 }
      );
    }

    await cancelWorkflow(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Cancel workflow error:", error);
    return NextResponse.json({ error: "取消 workflow 失败" }, { status: 500 });
  }
}
