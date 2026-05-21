import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:script:parse:id");

/**
 * Hotfix2 方案 B (2026-05-21)：剧本解析任务状态轮询
 *
 * 客户端 POST /api/script/parse 拿到 taskId 后，每 2 秒 GET 此接口。
 * 直到 status 是 COMPLETED 或 FAILED。
 *
 * 返回：
 *   - PROCESSING: { status: "PROCESSING" }
 *   - COMPLETED:  { status: "COMPLETED", result: ParsedScript }
 *   - FAILED:     { status: "FAILED", error: string }
 *
 * 鉴权：通过 input.userId 字段验证当前用户是任务发起人（避免越权读他人任务）。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { id } = await params;

    const task = await prisma.generationTask.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        input: true,
        output: true,
        error: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    if (task.type !== "SCRIPT_PARSE") {
      return NextResponse.json({ error: "任务类型不匹配" }, { status: 400 });
    }

    // 鉴权：input.userId 必须匹配当前 session
    const input = (task.input ?? {}) as { userId?: string };
    if (input.userId && input.userId !== session.user.id) {
      log.warn(
        `User ${session.user.id} tried to read task ${id} owned by ${input.userId}`
      );
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
    // PENDING / PROCESSING
    return NextResponse.json({ status: task.status });
  } catch (error) {
    log.error("Script parse status GET error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch task status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
