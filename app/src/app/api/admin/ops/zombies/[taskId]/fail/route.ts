/**
 * 手动标记单个僵尸任务为失败
 *
 * POST /api/admin/ops/zombies/[taskId]/fail
 *
 * 「立即清理」是批量的，且只处理超过 15 分钟阈值的任务。这个端点面向另一种
 * 场景：管理员看着某条任务确认它已经死了（对应进程早就没了），想单独回收，
 * 不必等阈值也不想触发全量清理。
 *
 * 与批量清理一致，除了改 task 本身，还要把关联 Scene 的对应状态位一起置
 * FAILED——只改 task 会让分镜永远卡在「生成中」，用户既看不到结果也无法重试。
 * 两者放同一事务，避免出现「任务失败但分镜仍在转圈」的中间态。
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { requestIp, writeAuditLog } from "@/lib/admin-audit";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:ops:zombies:fail");

export const dynamic = "force-dynamic";

/** 任务类型 → Scene 上对应的状态字段 */
const SCENE_STATUS_FIELD: Record<
  string,
  "imageStatus" | "videoStatus" | "audioStatus"
> = {
  IMAGE_GENERATE: "imageStatus",
  VIDEO_GENERATE: "videoStatus",
  AUDIO_GENERATE: "audioStatus",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  const { admin } = gate;

  const { taskId } = await params;

  try {
    const task = await prisma.generationTask.findUnique({
      where: { id: taskId },
      select: { id: true, type: true, status: true, sceneId: true },
    });

    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    // 只允许回收在途任务：已终结的任务再标失败会覆盖真实结果（比如把一条
    // 其实成功了的记录改成失败），属于数据破坏而非运维动作
    if (task.status !== "PROCESSING" && task.status !== "PENDING") {
      return NextResponse.json(
        { error: `任务当前状态为 ${task.status}，无需回收` },
        { status: 409 }
      );
    }

    const field = SCENE_STATUS_FIELD[task.type];
    const completedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.generationTask.update({
        where: { id: task.id },
        data: {
          status: "FAILED",
          error: "管理员手动标记失败（运维回收）",
          completedAt,
        },
      });

      if (task.sceneId && field) {
        // updateMany 而非 update：分镜可能已被用户删除，update 会抛 P2025
        // 让整个事务回滚，而任务本身的回收是应该生效的
        await tx.scene.updateMany({
          where: { id: task.sceneId },
          data: { [field]: "FAILED" },
        });
      }

      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "ops.task.fail",
        targetType: "ops",
        targetId: task.id,
        before: { status: task.status },
        after: { status: "FAILED", sceneId: task.sceneId, type: task.type },
        note: "运维页手动标记僵尸任务失败",
        ip: requestIp(request),
      });
    });

    log.info("手动回收僵尸任务", { taskId: task.id, actorId: admin.id });
    return NextResponse.json({ ok: true, taskId: task.id });
  } catch (error) {
    log.error("手动回收僵尸任务失败:", error);
    return NextResponse.json({ error: "标记失败失败" }, { status: 500 });
  }
}
