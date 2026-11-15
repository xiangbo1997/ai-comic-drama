import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runAssistantExecution } from "@/services/assistant-execution/runner";
import { sweepAssistantExecutions } from "@/services/assistant-execution/worker";

vi.mock("@/lib/prisma", () => ({
  prisma: { generationTask: { findMany: vi.fn() } },
}));
vi.mock("@/services/assistant-execution/runner", () => ({
  runAssistantExecution: vi.fn(async () => {}),
}));
vi.mock("@/services/assistant-execution/store", () => ({
  ownedExecution: () => ({ type: "SCRIPT_PARSE" }),
  executionState: (task: { output: unknown }) => task.output,
}));
const row = (id: string, status: string, extra = {}) => ({
  id,
  output: {
    status,
    confirmedAt: "2026-11-14",
    lease: null,
    steps: [],
    ...extra,
  },
});
beforeEach(() => vi.clearAllMocks());
describe("持久执行worker调度", () => {
  it("查询排除无unknown的暂停/终态任务，防旧计划阻塞新运行", async () => {
    vi.mocked(prisma.generationTask.findMany).mockResolvedValue([]);
    await sweepAssistantExecutions();
    expect(prisma.generationTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                {
                  output: {
                    path: ["steps"],
                    array_contains: [{ status: "unknown" }],
                  },
                },
              ]),
            }),
          ]),
        }),
      })
    );
  });
  it("只推进已确认且无活跃租约的run，未知任务仅reconcile", async () => {
    vi.mocked(prisma.generationTask.findMany).mockResolvedValue([
      row("unconfirmed", "running", { confirmedAt: null }),
      row("leased", "running", {
        lease: { token: "other", expiresAt: Date.now() + 60000 },
      }),
      row("unknown", "paused", { steps: [{ status: "unknown" }] }),
      row("ready", "running"),
    ] as never);
    await sweepAssistantExecutions();
    expect(runAssistantExecution).toHaveBeenCalledWith("unknown", true);
    expect(runAssistantExecution).toHaveBeenCalledWith("ready", false);
    expect(runAssistantExecution).toHaveBeenCalledTimes(2);
  });
});
