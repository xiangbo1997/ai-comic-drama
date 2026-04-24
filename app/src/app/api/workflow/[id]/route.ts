/**
 * Workflow [id] API — 获取状态 / 取消
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getWorkflowStatus, cancelWorkflow } from "@/services/agents/workflow-engine";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:workflow:id");

/** GET /api/workflow/[id] — 获取 workflow 详细状态 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    const status = await getWorkflowStatus(id);
    return NextResponse.json(status);
  } catch (error) {
    log.error("Get workflow status error:", error);
    return NextResponse.json({ error: "获取 workflow 状态失败" }, { status: 500 });
  }
}

/** DELETE /api/workflow/[id] — 取消 workflow */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
      return NextResponse.json({ error: "Workflow 已结束，无法取消" }, { status: 400 });
    }

    await cancelWorkflow(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Cancel workflow error:", error);
    return NextResponse.json({ error: "取消 workflow 失败" }, { status: 500 });
  }
}
