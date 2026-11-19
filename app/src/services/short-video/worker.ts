import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  canAccessShortVideo,
  shortVideoConfig,
} from "@/lib/short-video/config";
import { SvError, invariant } from "@/lib/short-video/errors";
import { activeRuns } from "@/lib/short-video/state";
import {
  acquireWorkerLease,
  acquireRunLease,
  renewWorker,
  fenced,
  type RunLease,
} from "./leases";
import { ownedRun, validatePlan, verifyScenes } from "./runs";
import { executeStep, reconcileStep, settleRunCompletion } from "./executor";
import { sweepPublications } from "./publications";
import { sweepHotBriefs } from "./hot-discovery/store";
import { sweepDiscovery } from "./discovery";
const log = createLogger("short-video:worker");
export async function driveRun(
  lease: RunLease,
  stopping: () => boolean = () => false
) {
  const current = await ownedRun(lease.userId, lease.runId);
  // 恢复先核对原凭证，开关关闭和用户停止均不能触发重新提交。
  for (const step of current.steps.filter((s) =>
    ["CLAIMED", "SUBMITTING", "PROCESSING", "UNKNOWN"].includes(s.status)
  )) {
    if (step.status === "CLAIMED") {
      await fenced(lease, async (tx) => {
        await tx.svRunStep.update({
          where: { id: step.id },
          data: { status: "PENDING" },
        });
      });
      continue;
    }
    const result = await reconcileStep(lease, step);
    if (result === "completed") continue;
    await fenced(lease, async (tx, run) => {
      if (result === "not_started") {
        await tx.svRunStep.update({
          where: { id: step.id },
          data: { status: "PENDING" },
        });
        await tx.svRun.update({
          where: { id: run.id },
          data: { reservedCredits: { decrement: step.estimatedCredits } },
        });
      } else {
        await tx.svRunStep.update({
          where: { id: step.id },
          data: {
            status: "UNKNOWN",
            errorCode: "UPSTREAM_UNKNOWN",
            errorSummary: "原请求结果未知，保留凭证；不会再次下单",
          },
        });
        await tx.svRun.update({
          where: { id: run.id },
          data: {
            status: run.stopRequestedAt ? "STOPPING" : "NEEDS_RECONCILIATION",
            errorCode: "UPSTREAM_UNKNOWN",
            errorSummary: "原任务无法自动核实，需人工核对供应方",
          },
        });
      }
    });
    if (result === "unknown") return;
  }
  for (;;) {
    if (stopping()) return;
    const run = await ownedRun(lease.userId, lease.runId);
    if (run.stopRequestedAt) {
      await fenced(lease, async (tx) => {
        await tx.svRun.update({
          where: { id: run.id },
          data: {
            status: "STOPPED",
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });
      });
      return;
    }
    if (run.steps.every((s) => s.status === "COMPLETED")) {
      await settleRunCompletion(lease);
      return;
    }
    if (!["QUEUED", "RUNNING"].includes(run.status)) return;
    const plan = await validatePlan(lease.userId, run, true);
    await verifyScenes(prisma, run, plan);
    const nextPlan = plan.steps.find(
      (s) =>
        run.steps.find((saved) => saved.key === s.key)?.status !== "COMPLETED"
    );
    const step = run.steps.find((s) => s.key === nextPlan?.key);
    invariant(step && step.status === "PENDING");
    const limits = shortVideoConfig();
    if (
      step.kind === "COMPOSE"
        ? !limits.composeConcurrency
        : !limits.autoSubmit || !limits.generationConcurrency
    )
      return;
    const claimed = await fenced(lease, async (tx, fresh) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: lease.userId },
      });
      if (!canAccessShortVideo(user)) return false;
      // 新模块的全局副作用限额由数据库状态控制，未知任务也占用，不依赖进程内闸门。
      const other = await tx.svRunStep.findFirst({
        where: {
          runId: { not: run.id },
          kind: step.kind === "COMPOSE" ? "COMPOSE" : { not: "COMPOSE" },
          status: { in: ["SUBMITTING", "PROCESSING", "UNKNOWN"] },
        },
      });
      if (other) return false;
      invariant(
        fresh.spentCredits + fresh.reservedCredits + step.estimatedCredits <=
          fresh.maxCredits,
        409,
        "BUDGET_EXCEEDED",
        "预算不足，请重新计划"
      );
      invariant(
        user.credits >= step.estimatedCredits,
        409,
        "INSUFFICIENT_CREDITS",
        "账户积分不足，可补足后继续"
      );
      const changed = await tx.svRunStep.updateMany({
        where: { id: step.id, status: "PENDING" },
        data: { status: "SUBMITTING", startedAt: new Date() },
      });
      if (!changed.count) return false;
      await tx.svRun.update({
        where: { id: run.id },
        data: {
          status: "RUNNING",
          startedAt: fresh.startedAt || new Date(),
          reservedCredits: { increment: step.estimatedCredits },
          version: { increment: 1 },
        },
      });
      return true;
    });
    if (!claimed) return;
    log.info("开始执行步骤", {
      runId: run.id,
      stepId: step.id,
      kind: step.kind,
      operationKey: step.operationKey,
      status: "SUBMITTING",
    });
    const started = Date.now();
    try {
      const result = await executeStep(lease, step, plan);
      log.info("步骤执行返回", {
        runId: run.id,
        stepId: step.id,
        status: result,
        durationMs: Date.now() - started,
      });
      if (result !== "completed") {
        await fenced(lease, async (tx, fresh) => {
          const unknown = result !== "not_started";
          await tx.svRunStep.update({
            where: { id: step.id },
            data: { status: unknown ? "UNKNOWN" : "PENDING" },
          });
          await tx.svRun.update({
            where: { id: run.id },
            data: {
              status: fresh.stopRequestedAt
                ? "STOPPING"
                : unknown
                  ? "NEEDS_RECONCILIATION"
                  : "PAUSED",
              ...(!unknown
                ? { reservedCredits: { decrement: step.estimatedCredits } }
                : {}),
              errorCode: unknown ? "UPSTREAM_UNKNOWN" : "NOT_SUBMITTED",
              errorSummary: unknown
                ? "结果未知，核对原任务后继续"
                : "原请求尚未提交，请检查开关与任务状态",
            },
          });
        });
        return;
      }
    } catch (error) {
      if (error instanceof SvError && error.code === "LEASE_LOST") throw error;
      if (step.kind === "COMPOSE") {
        await fenced(lease, async (tx, fresh) => {
          await tx.svRunStep.update({
            where: { id: step.id },
            data: {
              status: "PENDING",
              errorCode: "COMPOSE_FAILED",
              errorSummary:
                "本地合成失败，请检查媒体、磁盘和FFmpeg；原生成素材已保留",
            },
          });
          await tx.svRun.update({
            where: { id: fresh.id },
            data: {
              status: "PAUSED",
              reservedCredits: { decrement: step.estimatedCredits },
              errorCode: "COMPOSE_FAILED",
              errorSummary:
                "本地合成受阻，可修复环境后恢复；不会重新调用已完成的模型步骤",
            },
          });
        });
        return;
      }

      await fenced(lease, async (tx, fresh) => {
        const saved = fresh.steps.find((s) => s.id === step.id)!;
        if (saved.status === "COMPLETED") return;
        // 结构校验失败是确定失败；外部传输/落库失败保守按未知处理。
        const invalidScript =
          step.kind === "SCRIPT" &&
          (error instanceof SyntaxError ||
            (error instanceof Error && error.name === "ZodError"));
        await tx.svRunStep.update({
          where: { id: step.id },
          data: {
            status: invalidScript ? "FAILED" : "UNKNOWN",
            errorCode: invalidScript ? "INVALID_SCRIPT" : "UPSTREAM_UNKNOWN",
            errorSummary: invalidScript
              ? "模型输出未通过结构校验，未创建有效脚本"
              : "原操作结果不明，需核对",
          },
        });
        await tx.svRun.update({
          where: { id: run.id },
          data: {
            status: invalidScript ? "FAILED" : "NEEDS_RECONCILIATION",
            ...(invalidScript
              ? { reservedCredits: { decrement: step.estimatedCredits } }
              : {}),
            errorCode: invalidScript ? "INVALID_SCRIPT" : "UPSTREAM_UNKNOWN",
            errorSummary: invalidScript
              ? "脚本校验失败，不自动再次调用"
              : "保留原凭证，不会重提付费请求",
          },
        });
      });
      return;
    }
  }
}
export async function sweepShortVideo(
  owner: string,
  stopping: () => boolean = () => false
) {
  if (!shortVideoConfig().enabled || stopping()) return;
  const token = await acquireWorkerLease(owner);
  if (!token) return;
  let lost = false;
  const heartbeat = setInterval(() => {
    void renewWorker(token)
      .then((ok) => {
        if (!ok) lost = true;
      })
      .catch(() => {
        lost = true;
      });
  }, shortVideoConfig().heartbeatMs);
  const shouldStop = () => lost || stopping();
  try {
    const runs = await prisma.svRun.findMany({
      where: {
        confirmedAt: { not: null },
        OR: [
          { status: { in: activeRuns } },
          {
            steps: {
              some: { status: { in: ["UNKNOWN", "SUBMITTING", "PROCESSING"] } },
            },
          },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: 50,
      include: { user: true },
    });
    for (const row of runs) {
      if (shouldStop()) break;
      if (!canAccessShortVideo(row.user)) continue;
      const lease = await acquireRunLease(row.id, token, owner);
      if (!lease) continue;
      try {
        await driveRun(lease, shouldStop);
      } catch (error) {
        const code = error instanceof SvError ? error.code : "WORKER_ERROR";
        log.warn("执行暂停", { runId: row.id, code });
        if (code !== "LEASE_LOST")
          await fenced(lease, async (tx, run) => {
            await tx.svRun.update({
              where: { id: run.id },
              data: {
                status: "PAUSED",
                errorCode: code,
                errorSummary:
                  error instanceof SvError
                    ? error.message
                    : "任务执行受阻，请核对状态",
              },
            });
          }).catch(() => {});
      } finally {
        await prisma.svRun.updateMany({
          where: { id: row.id, leaseToken: token },
          data: { leaseToken: null, leaseUntil: null },
        });
      }
    }
    if (!shouldStop()) await sweepHotBriefs(undefined, shouldStop);
    if (!shouldStop()) await sweepDiscovery();
    if (!shouldStop()) await sweepPublications(token);
  } finally {
    clearInterval(heartbeat);
    await prisma.svWorker.updateMany({
      where: { id: "global", leaseToken: token },
      data: { leaseToken: null, leaseUntil: null, heartbeatAt: new Date() },
    });
  }
}
export async function workerHealth() {
  const [worker, due, unknown, expired, failures] = await Promise.all([
    prisma.svWorker.findUnique({
      where: { id: "global" },
      select: { heartbeatAt: true, leaseUntil: true },
    }),
    prisma.svPublication.count({
      where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    }),
    prisma.svRunStep.count({ where: { status: "UNKNOWN" } }),
    prisma.svPublication.count({ where: { status: "EXPIRED" } }),
    prisma.svRun.groupBy({
      by: ["errorCode"],
      where: { errorCode: { not: null } },
      _count: true,
    }),
  ]);
  return { worker, due, unknown, expired, failures };
}
