import { prisma } from "@/lib/prisma";
import {
  AssistantExecutionError,
  type AssistantExecutionStep,
} from "@/lib/assistant-execution";
import {
  claimAssistantExecution,
  mutateExecution,
  requireExecutionLease,
  EXECUTION_LEASE_MS,
} from "./store";
import {
  describeAssistantCapabilities,
  executeAssistantAction,
  reconcileAssistantAction,
} from "./tools";
import { readAssistantAssetFingerprint } from "./planner";
import { readAssistantReviewFingerprint } from "./review-fingerprint";

export async function runAssistantExecution(
  id: string,
  reconcileOnly = false
): Promise<void> {
  const claim = await claimAssistantExecution(id, reconcileOnly);
  if (!claim) return;
  const { userId, projectId, token } = claim;
  let lostLease = false;
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || lostLease) return;
    heartbeatBusy = true;
    void mutateExecution(id, userId, (state) => {
      requireExecutionLease(state, token);
      state.lease!.expiresAt = Date.now() + EXECUTION_LEASE_MS;
    })
      .catch(() => {
        lostLease = true;
      })
      .finally(() => {
        heartbeatBusy = false;
      });
  }, 10_000);
  heartbeat.unref();
  try {
    if (reconcileOnly) {
      const read = await mutateExecution(id, userId, (state) => {
        requireExecutionLease(state, token);
        return {
          step: state.steps.find((step) => step.status === "unknown"),
          options: state.options,
        };
      });
      const step = read.result.step;
      if (!step) return;
      const result = await reconcileAssistantAction(
        {
          userId,
          projectId,
          runId: id,
          operationKey: `assistant:${id}:${step.id}`,
          kind: step.kind,
          targetId: step.targetId,
          note: step.note,
          anchorSceneId: step.anchorSceneId,
          maxCost: step.maxCredits,
          options: read.result.options,
        },
        step.taskId
      );
      if (result.status === "completed" && result.result) {
        await mutateExecution(id, userId, (state) => {
          requireExecutionLease(state, token);
          state.steps.find((item) => item.id === step.id)!.status = "running";
        });
        await settle(step, result.result);
      } else if (
        result.status === "failed" ||
        result.status === "not_started"
      ) {
        await mutateExecution(id, userId, (state) => {
          requireExecutionLease(state, token);
          const current = state.steps.find((item) => item.id === step.id)!;
          current.status =
            result.status === "not_started" ? "pending" : "failed";
          state.budget.reserved -= step.maxCredits;
        });
      }
      return;
    }
    for (let iteration = 0; iteration < 500 && !lostLease; iteration++) {
      const selected = await mutateExecution(id, userId, (state) => {
        requireExecutionLease(state, token);
        if (!["running", "stopping"].includes(state.status)) return null;
        const running = state.steps.find((step) => step.status === "running");
        if (state.status === "stopping" && !running) {
          state.status = "stopped";
          state.currentStepId = null;
          return null;
        }
        const step =
          running ?? state.steps.find((item) => item.status === "pending");
        if (!step) {
          state.status = "completed";
          state.currentStepId = null;
          return null;
        }
        return {
          step: { ...step },
          options: state.options,
          configFingerprint: state.plan.configFingerprint,
          assetFingerprint: state.plan.assetFingerprint,
          reviewFingerprint: state.reviewFingerprint,
        };
      });
      if (!selected.result) return;
      const { step, options, configFingerprint } = selected.result;
      const actionInput = {
        userId,
        projectId,
        runId: id,
        operationKey: `assistant:${id}:${step.id}`,
        kind: step.kind,
        targetId: step.targetId,
        note: step.note,
        anchorSceneId: step.anchorSceneId,
        maxCost: step.maxCredits,
        options,
      };
      // 已启动动作永远先查询持久job，不能通过“重试”再次提交上游。
      if (step.status === "running") {
        const reconciled = await reconcileAssistantAction(
          actionInput,
          step.taskId
        );
        if (reconciled.status === "completed" && reconciled.result) {
          await settle(step, reconciled.result);
          continue;
        }
        if (reconciled.status !== "not_started") {
          await pauseStep(
            step,
            reconciled.status === "failed" ? "failed" : "unknown",
            reconciled.error ??
              "上次生成结果尚不明确，请先检查素材与任务；不会自动重复发单",
            reconciled.status === "failed"
          );
          return;
        }
      } else {
        if (
          ["links", "video"].includes(step.kind) &&
          (!selected.result.reviewFingerprint ||
            (await readAssistantReviewFingerprint(userId, projectId)) !==
              selected.result.reviewFingerprint)
        ) {
          await mutateExecution(id, userId, (state) => {
            requireExecutionLease(state, token);
            state.status = "paused";
            state.resumeBlocked = true;
            state.requiresAttention = true;
            state.error =
              "视觉检查后素材发生变化或检查凭证缺失，请重新计划并检查后再制作视频";
          });
          return;
        }
        if (
          step.kind === "prepare" &&
          selected.result.assetFingerprint &&
          (await readAssistantAssetFingerprint(userId, projectId, options)) !==
            selected.result.assetFingerprint
        ) {
          await mutateExecution(id, userId, (state) => {
            requireExecutionLease(state, token);
            state.status = "paused";
            state.resumeBlocked = true;
            state.requiresAttention = true;
            state.error = "确认后素材发生变化，请重新生成计划";
          });
          return;
        }
        const caps = await describeAssistantCapabilities({
          userId,
          projectId,
          options,
        });
        if (caps.configFingerprint !== configFingerprint) {
          await pause("模型配置或价格已变化，请重新生成计划后确认");
          return;
        }
        const shouldSkip = await existingAsset(step);
        if (shouldSkip) {
          await mutateExecution(id, userId, (state) => {
            requireExecutionLease(state, token);
            state.steps.find((item) => item.id === step.id)!.status = "skipped";
          });
          continue;
        }
        const started = await mutateExecution(
          id,
          userId,
          async (state, _task, tx) => {
            requireExecutionLease(state, token);
            if (state.status !== "running") return false;
            if (
              state.budget.spent + state.budget.reserved + step.maxCredits >
              state.budget.limit
            ) {
              state.status = "paused";
              state.error = "已到达本次积分上限，未启动后续生成";
              state.requiresAttention = true;
              return false;
            }
            const account = await tx.user.findUnique({
              where: { id: userId },
              select: { credits: true },
            });
            if (!account || account.credits < step.maxCredits) {
              state.status = "paused";
              state.error = "账户积分不足，未启动后续生成；补足后可继续";
              state.requiresAttention = true;
              return false;
            }
            const current = state.steps.find((item) => item.id === step.id)!;
            if (current.status !== "pending")
              throw new AssistantExecutionError("执行步骤已改变");
            current.status = "running";
            state.currentStepId = step.id;
            state.budget.reserved += step.maxCredits;
            return true;
          }
        );
        if (!started.result) return;
      }
      try {
        const result = await executeAssistantAction({
          ...actionInput,
          onTaskCreated: async (taskId) => {
            await mutateExecution(id, userId, (state) => {
              requireExecutionLease(state, token);
              if (state.status !== "running")
                throw new AssistantExecutionError(
                  "制作已停止，不再启动新的上游调用"
                );
              const current = state.steps.find((item) => item.id === step.id)!;
              if (current.taskId && current.taskId !== taskId)
                throw new AssistantExecutionError("生成任务编号冲突");
              current.taskId = taskId;
            });
          },
        });
        if (lostLease) return;
        await settle(step, result);
      } catch {
        if (lostLease) return;
        const reconciled = await reconcileAssistantAction(actionInput);
        if (reconciled.status === "completed" && reconciled.result) {
          await settle(step, reconciled.result);
          continue;
        }
        const knownFailure =
          reconciled.status === "failed" || reconciled.status === "not_started";
        await pauseStep(
          step,
          knownFailure ? "failed" : "unknown",
          knownFailure
            ? "本步骤未完成，请检查任务与素材后重新计划"
            : "生成结果暂时未知，已暂停以避免重复付费，请检查任务与素材",
          knownFailure
        );
        return;
      }
    }
    if (!lostLease) await pause("执行步骤达到安全上限，请检查当前集后重新计划");
  } catch {
    if (!lostLease)
      await pause(
        "后台执行已暂停，已完成素材与费用记录均保留，请刷新查看"
      ).catch(() => {});
  } finally {
    clearInterval(heartbeat);
    await mutateExecution(id, userId, (state) => {
      if (state.lease?.token === token) state.lease = null;
    }).catch(() => {});
  }

  async function pause(message: string) {
    await mutateExecution(id, userId, (state) => {
      requireExecutionLease(state, token);
      if (state.status !== "stopping") state.status = "paused";
      state.error = message;
      state.requiresAttention = true;
    });
  }
  async function pauseStep(
    step: AssistantExecutionStep,
    status: "failed" | "unknown",
    error: string,
    release: boolean
  ) {
    await mutateExecution(id, userId, (state) => {
      requireExecutionLease(state, token);
      const current = state.steps.find((item) => item.id === step.id)!;
      current.status = status;
      current.error = error;
      if (release) state.budget.reserved -= step.maxCredits;
      state.status = state.status === "stopping" ? "stopped" : "paused";
      state.error = error;
      state.requiresAttention = true;
      state.currentStepId = null;
    });
  }
  async function existingAsset(step: AssistantExecutionStep) {
    if (step.kind === "location")
      return !!(await prisma.projectLocation.findFirst({
        where: {
          projectId,
          OR: [{ id: step.targetId }, { locationKey: step.targetId }],
          imageUrl: { not: null },
        },
        select: { id: true },
      }));
    if (step.kind !== "image" && step.kind !== "video") return false;
    const scene = await prisma.scene.findFirst({
      where: { id: step.targetId, projectId, project: { userId } },
      select: { imageUrl: true, videoUrl: true },
    });
    if (!scene)
      throw new AssistantExecutionError("分镜已删除或不属于当前集", 404);
    return !!(step.kind === "image" ? scene.imageUrl : scene.videoUrl);
  }
  async function settle(
    step: AssistantExecutionStep,
    result: Awaited<ReturnType<typeof executeAssistantAction>>
  ) {
    if (
      !Number.isSafeInteger(result.actualCost) ||
      result.actualCost < 0 ||
      result.actualCost > step.maxCredits
    )
      throw new AssistantExecutionError(
        "任务实际费用超出已授权上限，已暂停核对"
      );
    await mutateExecution(id, userId, (state) => {
      requireExecutionLease(state, token);
      const current = state.steps.find((item) => item.id === step.id)!;
      if (current.status === "completed") return;
      if (current.status !== "running")
        throw new AssistantExecutionError("生成步骤状态已变化");
      current.status = "completed";
      current.actualCredits = result.actualCost;
      if (result.taskId) current.taskId = result.taskId;
      state.budget.reserved -= step.maxCredits;
      state.budget.spent += result.actualCost;
      state.currentStepId = null;
      if (
        step.kind === "inspect" &&
        !result.requiresReview &&
        result.artifact &&
        typeof result.artifact === "object"
      ) {
        const fingerprint = (result.artifact as { reviewFingerprint?: unknown })
          .reviewFingerprint;
        if (typeof fingerprint === "string" && fingerprint.length > 0)
          state.reviewFingerprint = fingerprint;
      }
      if (
        step.kind === "prepare" &&
        result.artifact &&
        typeof result.artifact === "object"
      ) {
        const keys = (result.artifact as { locations?: unknown }).locations;
        if (Array.isArray(keys)) {
          const existing = new Set([
            ...(state.plan.locationKeys ?? []),
            ...state.steps
              .filter((item) => item.kind === "location")
              .map((item) => item.targetId),
          ]);
          const newKeys = [
            ...new Set(
              keys.filter(
                (key): key is string =>
                  typeof key === "string" && key.length > 0 && key.length <= 255
              )
            ),
          ].filter((key) => !existing.has(key));
          if (newKeys.length > (state.plan.unlabeledLocationSlots ?? 0)) {
            state.status = "paused";
            state.resumeBlocked = true;
            state.requiresAttention = true;
            state.error = "识别出的新场景超出已授权计划，请重新计划";
            return;
          }
          const locationSteps: AssistantExecutionStep[] = newKeys.map(
            (key) => ({
              id: `location:${key}`,
              kind: "location",
              label: `补齐场景参考：${key}`,
              targetId: key,
              maxCredits: state.plan.locationCost ?? 0,
              status: "pending",
            })
          );
          state.steps.splice(
            state.steps.findIndex((item) => item.id === step.id) + 1,
            0,
            ...locationSteps
          );
        }
      }
      if (result.requiresReview && state.status !== "stopping") {
        state.status = "paused";
        state.requiresAttention = true;
        state.error =
          "素材已被修改或检查未完整执行，新产物保存在任务中，请检查后继续或重新计划";
        state.resumeBlocked = ["prepare", "inspect", "links"].includes(
          step.kind
        );
        return;
      }
      if (
        step.kind === "inspect" &&
        result.issues?.length &&
        state.status !== "stopping"
      ) {
        const issues = [
          ...new Map(
            result.issues
              .filter((issue) => state.plan.sceneIds.includes(issue.sceneId))
              .map((issue) => [issue.sceneId, issue])
          ).values(),
        ];
        if (!issues.length) return;
        if (state.repairRounds >= state.options.maxRepairRounds) {
          state.status = "paused";
          state.resumeBlocked = true;
          state.requiresAttention = true;
          state.error = `视觉检查仍有${issues.length}处需人工确认，已停止后续视频生成，请检查素材后重新计划`;
          return;
        }
        state.repairRounds++;
        const repairs: AssistantExecutionStep[] = issues.map((issue) => ({
          id: `repair:${state.repairRounds}:${issue.sceneId}`,
          kind: "repair",
          label: `第${state.repairRounds}轮修复画面`,
          targetId: issue.sceneId,
          maxCredits: state.plan.imageMaxCost,
          status: "pending",
          note: issue.note.slice(0, 1000),
          ...(issue.anchorSceneId &&
            state.plan.sceneIds.includes(issue.anchorSceneId) && {
              anchorSceneId: issue.anchorSceneId,
            }),
        }));
        repairs.push({
          id: `inspect:${state.repairRounds}`,
          kind: "inspect",
          label: `第${state.repairRounds}轮修复后复查`,
          maxCredits: 0,
          status: "pending",
        });
        const index = state.steps.findIndex((item) => item.id === step.id);
        state.steps.splice(index + 1, 0, ...repairs);
      }
      if (state.status === "stopping") state.status = "stopped";
    });
  }
}
