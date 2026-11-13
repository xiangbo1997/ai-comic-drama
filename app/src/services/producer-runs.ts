import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { GenerationTask } from "@prisma/client";
import { extractProducerCharacterNames } from "@/lib/producer-character-extract";
import { scriptToInputText } from "@/lib/drama-to-scenes";
import { normalizeProducerReview } from "@/lib/producer-review";
import {
  PRODUCER_STEPS,
  ProducerSettingsZ,
  type ProducerAction,
  type ProducerRunState,
  type ProducerRunSnapshot,
  type ProducerSettings,
} from "@/lib/producer-run";
import type { DramaScriptArtifact } from "@/types";

const KIND = "producer_checkpoint";
const LEASE_MS = 90000;
export class ProducerRunError extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message);
  }
}
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const owned = (userId: string, id?: string) => ({
  ...(id ? { id } : {}),
  type: "SCRIPT_PARSE" as const,
  AND: [
    { input: { path: ["kind"], equals: KIND } },
    { input: { path: ["userId"], equals: userId } },
  ],
});
function snapshot(task: GenerationTask): ProducerRunSnapshot {
  const { lease, ...state } = task.output as unknown as ProducerRunState;
  const input = task.input as unknown as { settings: ProducerSettings };
  return {
    ...state,
    id: task.id,
    projectId: task.projectId,
    settings: input.settings,
    leaseExpiresAt: lease?.expiresAt ?? null,
  };
}
export async function listProducerRuns(userId: string) {
  const tasks = await prisma.generationTask.findMany({
    where: owned(userId),
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return tasks.map(snapshot);
}
export async function readProducerRun(userId: string, id: string) {
  const task = await prisma.generationTask.findFirst({
    where: owned(userId, id),
  });
  if (!task) throw new ProducerRunError("找不到制片人草稿", 404);
  return snapshot(task);
}
export async function createProducerRun(
  userId: string,
  operationId: string,
  settings: ProducerSettings
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`producer-create:${userId}:${operationId}`},0))`;
    const existing = await tx.generationTask.findFirst({
      where: {
        ...owned(userId),
        AND: [
          ...owned(userId).AND,
          { input: { path: ["operationId"], equals: operationId } },
        ],
      },
    });
    if (existing) {
      const previous = (
        existing.input as unknown as { settings: ProducerSettings }
      ).settings;
      // JSONB会重排对象键；按schema固定字段顺序比较，不能把相同输入误判成冲突。
      if (
        JSON.stringify(ProducerSettingsZ.parse(previous)) !==
        JSON.stringify(ProducerSettingsZ.parse(settings))
      )
        throw new ProducerRunError("同一次创建不能使用不同点子，请新建草稿");
      return snapshot(existing);
    }
    // checkpoint不是后台生成任务：终态行避免被通用僵尸任务清理误判，流程状态保存在output。
    const task = await tx.generationTask.create({
      data: {
        type: "SCRIPT_PARSE",
        status: "COMPLETED",
        input: json({ kind: KIND, userId, operationId, settings }),
        output: json({
          version: 1,
          status: "paused",
          completedSteps: [],
          createdCharNames: [],
          lease: null,
          error: null,
        }),
        completedAt: new Date(),
      },
    });
    return snapshot(task);
  });
}
export async function advanceProducerRun(
  userId: string,
  id: string,
  action: ProducerAction
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`producer-run:${id}`},0))`;
    const task = await tx.generationTask.findFirst({
      where: owned(userId, id),
    });
    if (!task) throw new ProducerRunError("找不到制片人草稿", 404);
    const state = task.output as unknown as ProducerRunState;
    const { settings } = task.input as unknown as {
      settings: ProducerSettings;
    };
    const now = Date.now();
    const leaseValid = state.lease && state.lease.expiresAt > now;
    if (action.action === "claim") {
      if (leaseValid && state.lease?.token !== action.token)
        throw new ProducerRunError("另一个窗口正在制作，稍后可继续恢复");
      if (state.status !== "completed") {
        state.lease = { token: action.token, expiresAt: now + LEASE_MS };
        state.status = "running";
        state.error = null;
      }
    } else {
      // 所有推进均验证租约。页面刷新后旧持有者不能覆盖新窗口的checkpoint。
      if (!leaseValid || state.lease?.token !== action.token)
        throw new ProducerRunError("制作会话已过期，请重新打开向导继续");
      const requireStep = (step: (typeof PRODUCER_STEPS)[number]) => {
        const index = PRODUCER_STEPS.indexOf(step);
        if (
          !PRODUCER_STEPS.slice(0, index).every((s) =>
            state.completedSteps.includes(s)
          )
        )
          throw new ProducerRunError("请先完成上一步，再继续制作");
      };
      const complete = (step: (typeof PRODUCER_STEPS)[number]) => {
        if (!state.completedSteps.includes(step))
          state.completedSteps.push(step);
      };
      if (action.action === "release") {
        state.lease = null;
        state.error = action.error ?? null;
        state.status =
          state.status === "completed"
            ? "completed"
            : action.error
              ? "failed"
              : "paused";
      } else if (action.action !== "heartbeat") {
        if (task.projectId) {
          const project = await tx.project.findFirst({
            where: { id: task.projectId, userId },
            select: { id: true },
          });
          if (!project)
            throw new ProducerRunError("项目已删除，无法继续该草稿", 404);
        }
        if (action.action === "worldview") {
          if (!state.completedSteps.includes("worldview"))
            state.worldviewDraft = action.draft;
          complete("worldview");
        } else if (action.action === "project") {
          requireStep("project");
          if (!task.projectId) {
            const project = await tx.project.create({
              data: {
                title: state.worldviewDraft?.filmTitle || "AI 制片人项目",
                style: settings.style,
                aspectRatio: settings.aspectRatio,
                userId,
                generationParams: json(
                  settings.genre ? { genre: settings.genre } : {}
                ),
              },
            });
            task.projectId = project.id;
          }
          complete("project");
        } else if (action.action === "script") {
          requireStep("script");
          if (state.completedSteps.includes("script")) {
            if (state.scriptId !== action.scriptId)
              throw new ProducerRunError(
                "该草稿已锁定脚本，请新建制作草稿使用另一版脚本"
              );
          } else {
            const script = await tx.shortDramaScript.findFirst({
              where: { id: action.scriptId, projectId: task.projectId! },
            });
            if (!script)
              throw new ProducerRunError(
                "已生成脚本不存在或不属于本项目，请重试脚本步骤"
              );
            state.scriptId = script.id;
            state.artifact = script.scriptDoc as unknown as DramaScriptArtifact;
            complete("script");
          }
        } else if (action.action === "roster") {
          requireStep("characters");
          if (!state.roster) state.roster = action.roster;
        } else if (
          action.action === "character" ||
          action.action === "characters"
        ) {
          requireStep("characters");
          if (!state.artifact) throw new ProducerRunError("脚本状态缺失");
          const linked = await tx.projectCharacter.findMany({
            where: { projectId: task.projectId! },
            include: { character: { select: { name: true } } },
          });
          const names = new Set(
            linked.map((item) => item.character.name.trim())
          );
          if (action.action === "character") {
            if (!names.has(action.name.trim()))
              throw new ProducerRunError("该角色尚未关联到项目");
            if (!state.createdCharNames.includes(action.name))
              state.createdCharNames.push(action.name);
          } else {
            const expected = extractProducerCharacterNames(state.artifact);
            if (!expected.every((name) => names.has(name.trim())))
              throw new ProducerRunError("角色尚未全部建档，请继续重试");
            state.createdCharNames = expected;
            complete("characters");
          }
        } else if (action.action === "finalize") {
          requireStep("scenes");
          if (!state.artifact || !task.projectId)
            throw new ProducerRunError("脚本或项目缺失");
          // 与分镜重建、项目配置PATCH共用事务锁，在锁内读取并校验当前凭证。
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-scenes:${task.projectId}`},0))`;
          const project = await tx.project.findFirst({
            where: { id: task.projectId, userId },
            select: { generationParams: true },
          });
          const scenes = await tx.scene.findMany({
            where: { projectId: task.projectId },
            orderBy: { order: "asc" },
            select: { id: true },
          });
          if (!project || !scenes.length)
            throw new ProducerRunError("分镜尚未保存，请重试收尾");
          const receipt = await tx.generationTask.findFirst({
            where: {
              projectId: task.projectId,
              type: "SCRIPT_PARSE",
              status: "COMPLETED",
              AND: [
                { input: { path: ["kind"], equals: "producer_scene_apply" } },
                { input: { path: ["userId"], equals: userId } },
                {
                  input: {
                    path: ["operationId"],
                    equals: `producer-scenes:${id}`,
                  },
                },
              ],
            },
            orderBy: { createdAt: "desc" },
          });
          const appliedIds = (receipt?.output as { sceneIds?: unknown } | null)
            ?.sceneIds;
          if (
            !Array.isArray(appliedIds) ||
            appliedIds.length !== scenes.length ||
            !scenes.every((scene, index) => scene.id === appliedIds[index])
          )
            throw new ProducerRunError(
              "分镜已被其他操作替换或制作凭证缺失，请进入项目检查，当前草稿不会覆盖它"
            );
          const current = project.generationParams;
          if (!current || typeof current !== "object" || Array.isArray(current))
            throw new ProducerRunError("项目配置无效，请进入项目检查");
          const params = current as Record<string, unknown>;
          const producerReview = normalizeProducerReview(
            params.producerReview
          ) ?? {
            createdByProducer: true,
            confirmed: {
              worldview: false,
              script: false,
              characters: [],
              scenes: [],
            },
          };
          await tx.project.update({
            where: { id: task.projectId },
            data: {
              inputText: scriptToInputText(state.artifact),
              generationParams: json({
                ...params,
                producerReview,
                ...(settings.genre ? { genre: settings.genre } : {}),
              }),
            },
          });
          complete("scenes");
          state.status = "completed";
          state.error = null;
        }
      }
      if (state.lease) state.lease.expiresAt = now + LEASE_MS;
    }
    state.version++;
    const updated = await tx.generationTask.update({
      where: { id },
      data: { projectId: task.projectId, output: json(state) },
    });
    return snapshot(updated);
  });
}
