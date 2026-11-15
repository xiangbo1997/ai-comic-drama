import { prisma } from "@/lib/prisma";
import { ownedExecution, executionState } from "./store";
import { runAssistantExecution } from "./runner";

const globalWorker = globalThis as unknown as {
  assistantExecutionWorker?: ReturnType<typeof setInterval>;
  assistantExecutionSweep?: boolean;
  assistantExecutionInFlight?: Set<string>;
};
const inFlight = (globalWorker.assistantExecutionInFlight ??=
  new Set<string>());
export async function sweepAssistantExecutions() {
  if (globalWorker.assistantExecutionSweep) return;
  globalWorker.assistantExecutionSweep = true;
  try {
    const tasks = await prisma.generationTask.findMany({
      where: {
        ...ownedExecution(),
        OR: [
          { output: { path: ["status"], equals: "running" } },
          { output: { path: ["status"], equals: "stopping" } },
          {
            AND: [
              {
                OR: [
                  { output: { path: ["status"], equals: "paused" } },
                  { output: { path: ["status"], equals: "stopped" } },
                ],
              },
              {
                output: {
                  path: ["steps"],
                  array_contains: [{ status: "unknown" }],
                },
              },
            ],
          },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    const ready = tasks
      .filter((task) => {
        const state = executionState(task);
        return (
          !!state.confirmedAt &&
          !inFlight.has(task.id) &&
          (!state.lease || state.lease.expiresAt <= Date.now()) &&
          (["running", "stopping"].includes(state.status) ||
            state.steps.some((step) => step.status === "unknown"))
        );
      })
      .slice(0, Math.max(0, 2 - inFlight.size));
    for (const task of ready) {
      inFlight.add(task.id);
      const reconcileOnly = !["running", "stopping"].includes(
        executionState(task).status
      );
      // 不等待长生成，轮询器仍可接管其他已确认项目；每进程最多同时推进两个run。
      void runAssistantExecution(task.id, reconcileOnly)
        .catch(() => {})
        .finally(() => inFlight.delete(task.id));
    }
  } finally {
    globalWorker.assistantExecutionSweep = false;
  }
}
export function startAssistantExecutionWorker() {
  if (globalWorker.assistantExecutionWorker) return;
  // 只有已确认的持久任务会被扫描；未确认计划永不触发模型。
  globalWorker.assistantExecutionWorker = setInterval(() => {
    void sweepAssistantExecutions().catch(() => {});
  }, 15_000);
  globalWorker.assistantExecutionWorker.unref();
  void sweepAssistantExecutions().catch(() => {});
}
export function wakeAssistantExecutionWorker() {
  startAssistantExecutionWorker();
  void sweepAssistantExecutions().catch(() => {});
}
