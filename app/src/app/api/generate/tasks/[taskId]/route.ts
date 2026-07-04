/**
 * 生成任务状态轮询 API（图 / 视频 / TTS 异步化配套，2026-07-04）
 *
 * 客户端 POST /api/generate/{image,video,tts} 拿到 taskId 后轮询此接口：
 *   - PROCESSING: { status: "PROCESSING" }
 *   - COMPLETED:  { status: "COMPLETED", result: 与原同步响应同形的 output }
 *   - FAILED:     { status: "FAILED", error: string }
 *
 * 鉴权：input.userId 必须匹配当前 session（同 script/parse 轮询模式）。
 *
 * 僵尸回收：fire-and-forget 任务在进程重启时会永远停在 PROCESSING。
 * 这里按 updatedAt 惰性回收（超阈值置 FAILED 并同步把关联分镜置 FAILED）。
 * 扣费发生在成功事务内，僵尸任务从未扣费，回收无需退款。
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:generate:tasks");

const GENERATE_TASK_TYPES = [
  "IMAGE_GENERATE",
  "VIDEO_GENERATE",
  "AUDIO_GENERATE",
] as const;

/** 任务类型 → 关联分镜的状态字段（回收僵尸时同步置 FAILED） */
const SCENE_STATUS_FIELD: Record<
  string,
  "imageStatus" | "videoStatus" | "audioStatus"
> = {
  IMAGE_GENERATE: "imageStatus",
  VIDEO_GENERATE: "videoStatus",
  AUDIO_GENERATE: "audioStatus",
};

// 15 分钟无任何更新视为已死（单次生成含重试最长约 5 分钟，留足余量）
const ZOMBIE_THRESHOLD_MS = 15 * 60 * 1000;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
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
        type: true,
        status: true,
        input: true,
        output: true,
        error: true,
        sceneId: true,
        updatedAt: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    if (
      !GENERATE_TASK_TYPES.includes(
        task.type as (typeof GENERATE_TASK_TYPES)[number]
      )
    ) {
      return NextResponse.json({ error: "任务类型不匹配" }, { status: 400 });
    }

    // 鉴权：input.userId 必须匹配当前 session
    const input = (task.input ?? {}) as { userId?: string };
    if (input.userId && input.userId !== session.user.id) {
      log.warn(
        `User ${session.user.id} tried to read task ${taskId} owned by ${input.userId}`
      );
      return NextResponse.json({ error: "无权访问此任务" }, { status: 403 });
    }

    // 僵尸回收：进程重启后 PROCESSING 永远无人改写
    if (
      task.status === "PROCESSING" &&
      Date.now() - task.updatedAt.getTime() > ZOMBIE_THRESHOLD_MS
    ) {
      const zombieError = "任务已中断（服务重启或长时间无响应），请重试";
      const sceneField = SCENE_STATUS_FIELD[task.type];
      // scene 用 updateMany（不用 update）：分镜可能已被删/重解析，update 命中
      // 不存在行会 P2025 让整个回收事务回滚 → task 无法置 FAILED → 永卡
      // PROCESSING（a1 审计 P1-1）。updateMany 不存在则 count=0 静默通过。
      await prisma.$transaction([
        prisma.generationTask.update({
          where: { id: taskId },
          data: {
            status: "FAILED",
            error: zombieError,
            completedAt: new Date(),
          },
        }),
        ...(task.sceneId
          ? [
              prisma.scene.updateMany({
                where: { id: task.sceneId },
                data: { [sceneField]: "FAILED" },
              }),
            ]
          : []),
      ]);
      log.warn(`Recycled zombie generate task ${taskId} (${task.type})`);
      return NextResponse.json({ status: "FAILED", error: zombieError });
    }

    if (task.status === "COMPLETED") {
      return NextResponse.json({ status: "COMPLETED", result: task.output });
    }
    if (task.status === "FAILED") {
      return NextResponse.json({
        status: "FAILED",
        error: task.error ?? "生成失败",
      });
    }
    // PENDING / PROCESSING
    return NextResponse.json({ status: task.status });
  } catch (error) {
    log.error("Generate task status GET error:", error);
    return NextResponse.json({ error: "获取任务状态失败" }, { status: 500 });
  }
}
