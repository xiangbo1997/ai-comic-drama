import {
  canAccessShortVideo,
  shortVideoConfig,
} from "@/lib/short-video/config";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { GenerationJobError, type InternalGenerationOptions } from "./types";

export async function assertGenerationOwnership(
  userId: string,
  projectId?: string,
  sceneId?: string
) {
  if (
    projectId &&
    !(await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    }))
  ) {
    throw new GenerationJobError(404, { error: "Project not found" });
  }
  if (
    sceneId &&
    !(await prisma.scene.findFirst({
      where: {
        id: sceneId,
        ...(projectId ? { projectId } : {}),
        project: { userId },
      },
      select: { id: true },
    }))
  ) {
    throw new GenerationJobError(404, { error: "Scene not found" });
  }
}

/** 同一operation建单与查重位于同一PG事务锁中，避免崩溃丢失taskId后二次下单。 */
export async function createGenerationJob(
  args: { data: Prisma.GenerationTaskUncheckedCreateInput },
  userId: string,
  options: InternalGenerationOptions = {}
) {
  const { data } = args;
  if (options.executionRunId && options.shortVideoParent)
    throw new GenerationJobError(409, { error: "生成父任务范围不能混用" });
  if (
    options.maxCost !== undefined &&
    (!Number.isSafeInteger(options.maxCost) ||
      options.maxCost < 0 ||
      Number(data.cost ?? 0) > options.maxCost)
  ) {
    throw new GenerationJobError(409, {
      error: "本次生成报价超出已确认预算，请重新确认计划",
    });
  }
  const originalInput = data.input as Prisma.InputJsonObject;
  const requestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        type: data.type,
        projectId: data.projectId,
        sceneId: data.sceneId,
        input: originalInput,
        maxCost: options.maxCost,
        expectedSceneImageUrl: options.expectedSceneImageUrl,
        expectedVideoUrl: options.expectedVideoUrl,
        llmConfigId: options.llmConfigId,
        disableRetries: options.disableRetries,
      })
    )
    .digest("hex");
  const task = options.operationKey
    ? await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${options.operationKey}))`;
        const existing = await tx.generationTask.findFirst({
          where: {
            input: { path: ["operationKey"], equals: options.operationKey },
          },
        });
        if (existing) {
          const input = existing.input as Record<string, unknown>;
          if (
            input.userId !== userId ||
            (input.executionRunId ?? null) !==
              (options.executionRunId ?? null) ||
            (input.shortVideoRunId ?? null) !==
              (options.shortVideoParent?.runId ?? null) ||
            (input.requestFingerprint &&
              input.requestFingerprint !== requestFingerprint) ||
            existing.type !== data.type ||
            existing.projectId !== (data.projectId ?? null) ||
            existing.sceneId !== (data.sceneId ?? null)
          ) {
            throw new GenerationJobError(409, {
              error: "执行操作与现有任务不匹配",
            });
          }
          return existing;
        }
        return tx.generationTask.create({
          data: {
            ...data,
            status: "PENDING",
            input: {
              ...originalInput,
              userId,
              operationKey: options.operationKey!,
              executionRunId: options.executionRunId ?? null,
              ...(options.shortVideoParent
                ? { shortVideoRunId: options.shortVideoParent.runId }
                : {}),
              requestFingerprint,
            },
          },
        });
      })
    : await prisma.generationTask.create({ data });
  // 必须先让runner持久关联，再允许任何上游调用；失败时任务保持PENDING可恢复。
  await options.onTaskCreated?.(task.id);
  return task;
}

export async function claimGenerationJob(
  taskId: string,
  internal: boolean,
  executionRunId?: string,
  shortVideoParent?: { runId: string; leaseToken: string }
): Promise<boolean> {
  if (executionRunId && shortVideoParent) return false;
  if (!internal) return true;
  return prisma.$transaction(async (tx) => {
    if (shortVideoParent) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sv-run:${shortVideoParent.runId}`}, 0))`;
      const run = await tx.svRun.findUnique({
        where: { id: shortVideoParent.runId },
        include: { user: true, video: true },
      });
      const child = await tx.generationTask.findUnique({
        where: { id: taskId },
      });
      const input = child?.input as Record<string, unknown> | null;
      const step = await tx.svRunStep.findFirst({
        where: {
          runId: shortVideoParent.runId,
          generationTaskId: taskId,
          status: "SUBMITTING",
        },
      });
      if (
        !run ||
        !step ||
        child?.projectId !== run.video.projectId ||
        step.operationKey !== input?.operationKey ||
        run.status !== "RUNNING" ||
        !run.confirmedAt ||
        run.stopRequestedAt ||
        run.leaseToken !== shortVideoParent.leaseToken ||
        !run.leaseUntil ||
        run.leaseUntil <= new Date() ||
        !shortVideoConfig().autoSubmit ||
        !canAccessShortVideo(run.user) ||
        input?.shortVideoRunId !== run.id ||
        input?.userId !== run.userId
      )
        return false;
    }
    if (executionRunId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assistant-execution-run:${executionRunId}`},0))`;
      const run = await tx.generationTask.findUnique({
        where: { id: executionRunId },
        select: { output: true },
      });
      if ((run?.output as { status?: string } | null)?.status !== "running") {
        await tx.generationTask.updateMany({
          where: { id: taskId, status: "PENDING" },
          data: {
            status: "FAILED",
            output: { notStarted: true, unknown: false },
            error: "执行已停止或暂停，任务未提交上游",
            completedAt: new Date(),
          },
        });
        return false;
      }
    }
    const claim = await tx.generationTask.updateMany({
      where: { id: taskId, status: "PENDING" },
      data: { status: "PROCESSING", startedAt: new Date() },
    });
    return claim.count === 1;
  });
}
