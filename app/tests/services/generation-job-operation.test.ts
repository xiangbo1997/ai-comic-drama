import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  run: vi.fn(),
  create: vi.fn(),
  lock: vi.fn(),
  update: vi.fn(),
  ownProject: vi.fn(),
  ownScene: vi.fn(),
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: mocks.lock,
    generationTask: {
      findFirst: mocks.find,
      findUnique: mocks.run,
      create: mocks.create,
      updateMany: mocks.update,
    },
  };
  return {
    prisma: {
      ...tx,
      project: { findFirst: mocks.ownProject },
      scene: { findFirst: mocks.ownScene },
      $transaction: (fn: (tx: unknown) => unknown) => fn(tx),
    },
  };
});
import {
  assertGenerationOwnership,
  claimGenerationJob,
  createGenerationJob,
} from "@/services/generation/jobs/operation";
const data = {
  type: "IMAGE_GENERATE" as const,
  projectId: "p1",
  sceneId: "s1",
  input: { userId: "u1" },
  cost: 3,
};
const options = { operationKey: "op1", executionRunId: "run1", maxCost: 3 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(null);
  mocks.create.mockImplementation(async ({ data }) => ({
    ...data,
    id: "task1",
  }));
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.run.mockResolvedValue({ output: { status: "running" } });
});
describe("durable generation operation receipts", () => {
  it("locks and persists PENDING before notifying the runner", async () => {
    const callback = vi.fn(async () => {
      expect(mocks.create).toHaveBeenCalledOnce();
    });
    const task = await createGenerationJob({ data }, "u1", {
      ...options,
      onTaskCreated: callback,
    });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(task.status).toBe("PENDING");
    expect(task.input).toMatchObject({
      operationKey: "op1",
      executionRunId: "run1",
      userId: "u1",
    });
    expect(callback).toHaveBeenCalledWith("task1");
  });
  it("reuses an existing receipt without creating another paid job", async () => {
    mocks.find.mockResolvedValue({
      ...data,
      id: "task1",
      input: { userId: "u1", executionRunId: "run1" },
    });
    expect((await createGenerationJob({ data }, "u1", options)).id).toBe(
      "task1"
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects scope mismatch and excess budget before submission", async () => {
    await expect(
      createGenerationJob({ data }, "u1", { ...options, maxCost: 2 })
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.find.mockResolvedValue({
      ...data,
      id: "foreign",
      input: { userId: "u2", executionRunId: "run1" },
    });
    await expect(
      createGenerationJob({ data }, "u1", options)
    ).rejects.toMatchObject({ status: 409 });
  });
  it("callback failure leaves a recoverable receipt and never claims upstream execution", async () => {
    await expect(
      createGenerationJob({ data }, "u1", {
        ...options,
        onTaskCreated: async () => {
          throw new Error("runner write failed");
        },
      })
    ).rejects.toThrow("runner write failed");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("only PENDING jobs are claimable", async () => {
    mocks.update.mockResolvedValueOnce({ count: 0 });
    expect(await claimGenerationJob("task1", true)).toBe(false);
    expect(mocks.update.mock.calls[0][0].where).toEqual({
      id: "task1",
      status: "PENDING",
    });
  });
  it("rejects a changed request using the same operation key", async () => {
    const task = await createGenerationJob({ data }, "u1", options);
    mocks.find.mockResolvedValue(task);
    await expect(
      createGenerationJob(
        { data: { ...data, input: { userId: "u1", prompt: "changed" } } },
        "u1",
        options
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("locks the running parent before claiming a child", async () => {
    expect(await claimGenerationJob("task1", true, "run1")).toBe(true);
    expect(mocks.run).toHaveBeenCalledWith({
      where: { id: "run1" },
      select: { output: true },
    });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0][0].data.status).toBe("PROCESSING");
  });
  it("does not submit a child after its parent is stopped", async () => {
    mocks.run.mockResolvedValue({ output: { status: "stopped" } });
    expect(await claimGenerationJob("task1", true, "run1")).toBe(false);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      where: { id: "task1", status: "PENDING" },
      data: { status: "FAILED", output: { notStarted: true, unknown: false } },
    });
  });
  it("requires a scene to belong to both the supplied project and user", async () => {
    mocks.ownProject.mockResolvedValue({ id: "p1" });
    mocks.ownScene.mockResolvedValue(null);
    await expect(
      assertGenerationOwnership("u1", "p1", "s1")
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.ownScene.mock.calls[0][0].where).toEqual({
      id: "s1",
      projectId: "p1",
      project: { userId: "u1" },
    });
  });
});
