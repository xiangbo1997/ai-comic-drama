/**
 * GET /api/projects/[id]/locations/[locationId]/generate/[taskId]
 * 轮询空景板生成任务状态。鉴权：task.input.userId 必须匹配当前 session，
 * 且 input.kind 必须为 location_plate（专用轮询，与通用 tasks 轮询解耦——
 * 空景板无关联 Scene，不参与通用轮询的僵尸回收 SCENE_STATUS_FIELD 联动）。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:projects:locations:plate:status");

interface RouteParams {
  params: Promise<{ id: string; locationId: string; taskId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { taskId } = await params;
    const task = await prisma.generationTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        input: true,
        output: true,
        error: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const input = (task.input ?? {}) as { userId?: string; kind?: string };
    if (input.kind !== "location_plate") {
      return NextResponse.json({ error: "任务类型不匹配" }, { status: 400 });
    }
    if (input.userId && input.userId !== session.user.id) {
      return NextResponse.json({ error: "无权访问此任务" }, { status: 403 });
    }

    if (task.status === "COMPLETED") {
      return NextResponse.json({ status: "COMPLETED", result: task.output });
    }
    if (task.status === "FAILED") {
      return NextResponse.json({
        status: "FAILED",
        error: task.error ?? "Unknown error",
      });
    }
    return NextResponse.json({ status: task.status });
  } catch (error) {
    log.error("Location plate status error:", error);
    return NextResponse.json({ error: "查询任务状态失败" }, { status: 500 });
  }
}
