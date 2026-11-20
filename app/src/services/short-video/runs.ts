import { stableHash } from "@/lib/short-video/hash";
import { prisma } from "@/lib/prisma";
import { RunActionZ } from "@/lib/short-video/contracts";
import { invariant } from "@/lib/short-video/errors";
import { shortVideoConfig } from "@/lib/short-video/config";
import { PlanZ, configState, priceState, type Plan } from "./plans";
import { receipt, runLock, assertIdle, dto, type Tx } from "./store";
export async function ownedRun(userId: string, id: string, tx: Tx = prisma) {
  const run = await tx.svRun.findFirst({
    where: { id, userId },
    include: { steps: { orderBy: { createdAt: "asc" } }, video: true },
  });
  invariant(run, 404, "NOT_FOUND", "任务不存在");
  return run;
}
export async function readRun(userId: string, id: string) {
  const run = await ownedRun(userId, id);
  const { leaseToken: _, leaseOwner: __, ...safe } = run;
  void _;
  void __;
  return dto(safe);
}
export async function validatePlan(
  userId: string,
  run: Awaited<ReturnType<typeof ownedRun>>,
  checkVersion: boolean
) {
  const plan = PlanZ.parse(run.plan);
  const [config, prices] = await Promise.all([
    configState(userId, plan.configIds),
    priceState(),
  ]);
  invariant(
    config.fingerprint === run.configFingerprint &&
      prices.fingerprint === run.priceFingerprint,
    409,
    "PLAN_STALE",
    "模型配置或报价已变化，请重新计划"
  );
  if (plan.projectFingerprint) {
    const project = await prisma.project.findFirst({
      where: { id: run.video.projectId!, userId },
    });
    invariant(
      project &&
        stableHash({
          style: project.style,
          aspectRatio: project.aspectRatio,
          generationParams: project.generationParams,
        }) === plan.projectFingerprint,
      409,
      "PROJECT_CHANGED",
      "关联项目的生成参数已变化，请重新计划"
    );
  }
  if (checkVersion)
    invariant(
      run.video.version === plan.videoVersion && !run.video.archivedAt,
      409,
      "PLAN_STALE",
      "作品已变化，请重新计划"
    );
  return plan;
}
export async function verifyScenes(
  tx: Tx,
  run: Awaited<ReturnType<typeof ownedRun>>,
  plan: Plan
) {
  for (const mapped of plan.sceneMap) {
    const scene = await tx.scene.findFirst({
      where: {
        id: mapped.sceneId,
        projectId: run.video.projectId!,
        project: { userId: run.userId },
      },
    });
    invariant(scene, 409, "SCENE_CHANGED", "分镜已变化，请重新计划");
    invariant(
      scene.description === mapped.description &&
        (scene.dialogue ?? "") === mapped.dialogue &&
        (scene.narration ?? "") === mapped.narration,
      409,
      "SCENE_CHANGED",
      "分镜文字已变化"
    );
    const videoStep = run.steps.find(
      (s) =>
        s.kind === "VIDEO" &&
        s.status === "COMPLETED" &&
        (s.input as Record<string, unknown>).sceneId === mapped.sceneId
    );
    const videoOutput = videoStep?.output as Record<string, unknown> | null;
    invariant(
      scene.duration ===
        (typeof videoOutput?.duration === "number"
          ? Math.round(videoOutput.duration)
          : mapped.duration),
      409,
      "SCENE_CHANGED",
      "分镜时长已修改"
    );
    for (const [kind, field] of [
      ["IMAGE", "imageUrl"],
      ["VIDEO", "videoUrl"],
      ["TTS", "audioUrl"],
    ] as const) {
      const completed = run.steps.find(
        (s) =>
          s.kind === kind &&
          s.status === "COMPLETED" &&
          (s.input as Record<string, unknown>).sceneId === mapped.sceneId
      );
      const output = completed?.output as Record<string, unknown> | null;
      invariant(
        (scene[field] ?? null) === (output?.url ?? null),
        409,
        "ASSET_CHANGED",
        "分镜素材已被修改，已生成结果保留，请核对后重新计划"
      );
    }
  }
}
export async function controlRun(userId: string, id: string, raw: unknown) {
  const input = RunActionZ.parse(raw);
  await receipt(userId, `run:${id}:action`, input, async (tx) => {
    await runLock(tx, id);
    const run = await ownedRun(userId, id, tx);
    invariant(run.version === input.expectedVersion);
    if (input.action === "confirm") {
      invariant(run.status === "PLANNED");
      invariant(
        input.planHash === run.planHash,
        409,
        "PLAN_HASH_CHANGED",
        "请重新预览完整计划"
      );
      invariant(
        shortVideoConfig().autoSubmit,
        409,
        "SUBMISSION_DISABLED",
        "新付费提交开关已关闭"
      );
      await assertIdle(tx, run.videoId);
      const plan = await validatePlan(userId, run, true);
      await verifyScenes(tx, run, plan);
      await tx.svRun.update({
        where: { id },
        data: {
          status: "QUEUED",
          confirmedAt: new Date(),
          version: { increment: 1 },
        },
      });
    } else if (input.action === "stop") {
      invariant(
        [
          "PLANNED",
          "QUEUED",
          "RUNNING",
          "PAUSED",
          "NEEDS_RECONCILIATION",
          "STOPPING",
        ].includes(run.status)
      );
      const pending = run.steps.some((s) =>
        ["SUBMITTING", "PROCESSING", "UNKNOWN"].includes(s.status)
      );
      await tx.svRun.update({
        where: { id },
        data: {
          stopRequestedAt: new Date(),
          status: pending ? "STOPPING" : "STOPPED",
          version: { increment: 1 },
        },
      });
    } else if (input.action === "resume") {
      invariant(
        run.status === "PAUSED" &&
          !run.stopRequestedAt &&
          !run.steps.some((s) =>
            ["UNKNOWN", "SUBMITTING", "PROCESSING"].includes(s.status)
          )
      );
      // 关闭收费提交后，已完成模型步骤的任务仍可只用现有素材恢复本地合成。
      invariant(
        shortVideoConfig().autoSubmit ||
          run.steps.every(
            (s) => s.status === "COMPLETED" || s.kind === "COMPOSE"
          ),
        409,
        "SUBMISSION_DISABLED",
        "新提交已关闭"
      );
      const plan = await validatePlan(userId, run, true);
      await verifyScenes(tx, run, plan);
      await tx.svRun.update({
        where: { id },
        data: {
          status: "QUEUED",
          version: { increment: 1 },
          errorCode: null,
          errorSummary: null,
        },
      });
    } else {
      invariant(
        run.confirmedAt &&
          run.steps.some((s) =>
            ["UNKNOWN", "SUBMITTING", "PROCESSING"].includes(s.status)
          ),
        409,
        "NOTHING_TO_RECONCILE",
        "没有可核对的原任务"
      );
      // 核对只唤醒原凭证，不清空未知状态或允许新的提交。
      await tx.svRun.update({
        where: { id },
        data: { heartbeatAt: run.heartbeatAt, version: { increment: 1 } },
      });
    }
    return { id };
  });
  return readRun(userId, id);
}
