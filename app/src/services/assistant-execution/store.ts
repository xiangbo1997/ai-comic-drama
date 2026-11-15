import { randomUUID } from "node:crypto";
import { Prisma, type GenerationTask } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AssistantExecutionError,
  type AssistantExecutionOptions,
  type AssistantExecutionPlan,
  type AssistantExecutionSnapshot,
  type AssistantExecutionState,
} from "@/lib/assistant-execution";
import {
  buildAssistantExecutionPlan,
  readAssistantAssetFingerprint,
} from "./planner";

export const ASSISTANT_EXECUTION_KIND = "assistant_execution_run";
export const EXECUTION_LEASE_MS = 45_000;
export const executionJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const ownedExecution = (
  userId?: string,
  id?: string,
  projectId?: string
) => ({
  ...(id && { id }),
  ...(projectId && { projectId }),
  type: "SCRIPT_PARSE" as const,
  AND: [
    { input: { path: ["kind"], equals: ASSISTANT_EXECUTION_KIND } },
    ...(userId ? [{ input: { path: ["userId"], equals: userId } }] : []),
  ],
});
export function executionState(task: GenerationTask): AssistantExecutionState {
  return task.output as unknown as AssistantExecutionState;
}
export function executionSnapshot(
  task: GenerationTask
): AssistantExecutionSnapshot {
  const {
    lease: _lease,
    controlRequests: _requests,
    ...state
  } = executionState(task);
  return {
    ...state,
    id: task.id,
    projectId: task.projectId!,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
async function assertProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, seriesId: true },
  });
  if (!project) throw new AssistantExecutionError("当前集不存在", 404);
  if (
    project.seriesId &&
    !(await prisma.series.findFirst({
      where: { id: project.seriesId, userId },
      select: { id: true },
    }))
  )
    throw new AssistantExecutionError("系列不存在", 404);
}
export async function readAssistantExecution(userId: string, id: string) {
  const task = await prisma.generationTask.findFirst({
    where: ownedExecution(userId, id),
  });
  if (!task?.projectId)
    throw new AssistantExecutionError("执行任务不存在", 404);
  await assertProject(userId, task.projectId);
  return executionSnapshot(task);
}
export async function latestAssistantExecution(
  userId: string,
  projectId: string
) {
  await assertProject(userId, projectId);
  const task = await prisma.generationTask.findFirst({
    where: ownedExecution(userId, undefined, projectId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return task ? executionSnapshot(task) : null;
}
export async function createAssistantExecution(
  userId: string,
  requestId: string,
  projectId: string,
  options: AssistantExecutionOptions
) {
  await assertProject(userId, projectId);
  // 同requestId重取原计划，不要求已确认任务的素材仍等于创建时。
  const plan = await buildAssistantExecutionPlan(userId, projectId, options);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assistant-execution-create:${userId}:${requestId}`},0))`;
    const existing = await tx.generationTask.findFirst({
      where: {
        ...ownedExecution(userId),
        AND: [
          ...ownedExecution(userId).AND,
          { input: { path: ["requestId"], equals: requestId } },
        ],
      },
    });
    if (existing) {
      const previous = existing.input as unknown as {
        options: AssistantExecutionOptions;
      };
      if (
        existing.projectId !== projectId ||
        JSON.stringify(previous.options) !==
          JSON.stringify(JSON.parse(JSON.stringify(options)))
      ) {
        // JSONB对象键顺序不固定，下面按固定字段比较。
        const stable = (value: AssistantExecutionOptions) => [
          value.maxCredits,
          value.maxRepairRounds,
          value.generateVideos,
          value.imageConfigId ?? null,
          value.videoConfigId ?? null,
          value.llmConfigId ?? null,
        ];
        if (
          existing.projectId !== projectId ||
          JSON.stringify(stable(previous.options)) !==
            JSON.stringify(stable(options))
        )
          throw new AssistantExecutionError("该请求编号已用于另一份计划");
      }
      return executionSnapshot(existing);
    }
    const state: AssistantExecutionState = {
      status: "planned",
      version: 1,
      plan,
      options,
      budget: { limit: options.maxCredits, spent: 0, reserved: 0 },
      steps: plan.steps.map((step) => ({ ...step, status: "pending" })),
      repairRounds: 0,
      currentStepId: null,
      error: null,
      requiresAttention: false,
      confirmedAt: null,
      lease: null,
      controlRequests: [],
    };
    const task = await tx.generationTask.create({
      data: {
        projectId,
        type: "SCRIPT_PARSE",
        status: "COMPLETED",
        input: executionJson({
          kind: ASSISTANT_EXECUTION_KIND,
          userId,
          projectId,
          requestId,
          options,
        }),
        output: executionJson(state),
        completedAt: new Date(),
      },
    });
    return executionSnapshot(task);
  });
}

export async function mutateExecution<T>(
  id: string,
  userId: string | undefined,
  fn: (
    state: AssistantExecutionState,
    task: GenerationTask,
    tx: Prisma.TransactionClient
  ) => T | Promise<T>
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assistant-execution-run:${id}`},0))`;
    const task = await tx.generationTask.findFirst({
      where: ownedExecution(userId, id),
    });
    if (!task?.projectId)
      throw new AssistantExecutionError("执行任务不存在", 404);
    const ownerId = (task.input as { userId: string }).userId;
    const project = await tx.project.findFirst({
      where: { id: task.projectId, userId: ownerId },
      select: { id: true, seriesId: true },
    });
    if (
      !project ||
      (project.seriesId &&
        !(await tx.series.findFirst({
          where: { id: project.seriesId, userId: ownerId },
          select: { id: true },
        })))
    )
      throw new AssistantExecutionError("当前集不存在或归属已改变", 404);
    const state = executionState(task);
    const result = await fn(state, task, tx);
    state.version++;
    const updated = await tx.generationTask.update({
      where: { id },
      data: { output: executionJson(state) },
    });
    return { result, snapshot: executionSnapshot(updated) };
  });
}

export async function controlAssistantExecution(
  userId: string,
  id: string,
  action: "confirm" | "resume" | "stop",
  requestId: string
) {
  const previous = await readAssistantExecution(userId, id);
  let currentPlan: AssistantExecutionPlan | undefined;
  if (action === "confirm" && previous.status === "planned")
    currentPlan = await buildAssistantExecutionPlan(
      userId,
      previous.projectId,
      previous.options
    );
  const result = await mutateExecution(id, userId, async (state, task, tx) => {
    const replay = state.controlRequests.find(
      (item) => item.requestId === requestId
    );
    if (replay) {
      if (replay.action !== action)
        throw new AssistantExecutionError("该请求编号已用于另一种操作");
      return;
    }
    if (action === "stop") {
      if (
        state.status === "completed" ||
        state.status === "stopped" ||
        state.status === "failed"
      )
        return;
      state.status = state.steps.some((step) => step.status === "running")
        ? "stopping"
        : "stopped";
      if (state.status === "stopped") {
        state.lease = null;
        state.currentStepId = null;
      }
    } else {
      if (action === "confirm") {
        if (state.confirmedAt) return;
        if (state.status !== "planned")
          throw new AssistantExecutionError("该计划已结束，请重新创建计划");
        if (!currentPlan || currentPlan.fingerprint !== state.plan.fingerprint)
          throw new AssistantExecutionError(
            "素材或模型配置已变化，请重新生成计划"
          );
        // 确认事务锁定既有素材并重读；等待锁期间发生的编辑也必须使旧计划失效。
        await tx.$executeRaw`SELECT "id" FROM "Project" WHERE "id"=${task.projectId} FOR UPDATE`;
        await tx.$executeRaw`SELECT "id" FROM "Scene" WHERE "projectId"=${task.projectId} ORDER BY "id" FOR SHARE`;
        await tx.$executeRaw`SELECT "id" FROM "ProjectLocation" WHERE "projectId"=${task.projectId} ORDER BY "id" FOR SHARE`;
        await tx.$executeRaw`SELECT c."id" FROM "Character" c JOIN "ProjectCharacter" pc ON pc."characterId"=c."id" WHERE pc."projectId"=${task.projectId} ORDER BY c."id" FOR SHARE OF c,pc`;
        await tx.$executeRaw`SELECT sc."id" FROM "SceneCharacter" sc JOIN "Scene" s ON s."id"=sc."sceneId" WHERE s."projectId"=${task.projectId} ORDER BY sc."id" FOR SHARE OF sc`;
        const lockedFingerprint = await readAssistantAssetFingerprint(
          userId,
          task.projectId!,
          state.options,
          tx
        );
        if (lockedFingerprint !== state.plan.assetFingerprint)
          throw new AssistantExecutionError(
            "素材在确认时已变化，请重新生成计划"
          );
        if (state.plan.blockers.length)
          throw new AssistantExecutionError(state.plan.blockers[0], 400);
      } else {
        if (!state.confirmedAt || state.status !== "paused")
          throw new AssistantExecutionError("当前任务无法继续");
        if (state.resumeBlocked)
          throw new AssistantExecutionError(
            "画面检查尚未通过，请检查素材后重新生成计划"
          );
        if (
          state.steps.some(
            (step) => step.status === "unknown" || step.status === "failed"
          )
        )
          throw new AssistantExecutionError(
            "存在结果未知或失败的任务，请先检查已生成素材并重新计划，避免重复付费"
          );
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assistant-execution-project:${task.projectId}`},0))`;
      const others = await tx.generationTask.findMany({
        where: {
          ...ownedExecution(userId, undefined, task.projectId!),
          id: { not: id },
        },
        select: { output: true },
      });
      if (
        others.some((other) => {
          const previous = other.output as unknown as AssistantExecutionState;
          return (
            ["running", "stopping"].includes(previous.status) ||
            previous.steps.some(
              (step) => step.status === "unknown" || step.status === "running"
            )
          );
        })
      )
        throw new AssistantExecutionError(
          "当前集已有制作或结果未知的任务，请先等待任务结算并检查素材"
        );
      state.confirmedAt ??= new Date().toISOString();
      state.status = "running";
      state.error = null;
      state.requiresAttention = false;
    }
    state.controlRequests.push({ requestId, action });
    state.controlRequests = state.controlRequests.slice(-100);
  });
  return result.snapshot;
}

export async function claimAssistantExecution(
  id: string,
  reconcileOnly = false
) {
  const token = randomUUID();
  const { result } = await mutateExecution(id, undefined, (state, task) => {
    if (
      !state.confirmedAt ||
      (!reconcileOnly && !["running", "stopping"].includes(state.status))
    )
      return null;
    if (reconcileOnly && !state.steps.some((step) => step.status === "unknown"))
      return null;
    if (state.lease && state.lease.expiresAt > Date.now()) return null;
    state.lease = { token, expiresAt: Date.now() + EXECUTION_LEASE_MS };
    return {
      token,
      userId: (task.input as { userId: string }).userId,
      projectId: task.projectId!,
    };
  });
  return result;
}
export function requireExecutionLease(
  state: AssistantExecutionState,
  token: string
) {
  if (state.lease?.token !== token || state.lease.expiresAt <= Date.now())
    throw new AssistantExecutionError("制作执行租约已失效");
}
