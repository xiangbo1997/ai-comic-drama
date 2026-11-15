import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  scene: vi.fn(),
  prior: vi.fn(),
  count: vi.fn(),
  attempt: vi.fn(),
  current: vi.fn(),
  task: vi.fn(),
  charge: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        scene: { updateMany: mocks.scene },
        generationAttempt: {
          findFirst: mocks.prior,
          count: mocks.count,
          create: mocks.attempt,
          updateMany: mocks.current,
        },
        generationTask: { update: mocks.task },
      }),
  },
}));
vi.mock("@/lib/credits", () => ({ chargeCredits: mocks.charge }));
vi.mock("@/services/generation", () => ({ mergeSimilarityScores: () => ({}) }));
import { persistImageResult } from "@/services/generation/image-request/persist";
const params = {
  taskId: "t1",
  userId: "u1",
  projectId: "p1",
  sceneId: "s1",
  expectedSceneImageUrl: "old-url",
  successes: [
    {
      imageUrl: "new-url",
      result: { strategy: "reference_edit", attemptCount: 1 },
    },
  ],
  scores: [{ vlmScore: null, vlmReason: null }],
  recommendedIdx: 0,
  imageUrl: "new-url",
  chosenResult: { strategy: "reference_edit", attemptCount: 1 },
  actualCost: 3,
  provider: "openai",
  model: "test",
  iterationNote: "修正服装",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.scene.mockResolvedValue({ count: 1 });
  mocks.prior.mockResolvedValue(null);
  mocks.count.mockResolvedValue(0);
  mocks.attempt.mockResolvedValue({ id: "attempt" });
});
describe("assistant image repair commit", () => {
  it("retains an old uploaded asset before selecting the generated version", async () => {
    await persistImageResult(params);
    expect(mocks.scene.mock.calls[0][0].where).toEqual({
      id: "s1",
      projectId: "p1",
      imageUrl: "old-url",
    });
    expect(mocks.attempt.mock.calls[0][0].data).toMatchObject({
      outputUrl: "old-url",
      strategy: "preserved_original",
      isCurrent: false,
    });
    expect(mocks.attempt.mock.calls[1][0].data).toMatchObject({
      outputUrl: "new-url",
      isCurrent: true,
    });
    expect(mocks.task.mock.calls[0][0].data.output).toMatchObject({
      conflict: false,
      applied: true,
    });
  });
  it("preserves user edits and records generated material as a noncurrent version on conflict", async () => {
    mocks.scene.mockResolvedValue({ count: 0 });
    await persistImageResult(params);
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.attempt.mock.calls[1][0].data.isCurrent).toBe(false);
    expect(mocks.task.mock.calls[0][0].data.output).toMatchObject({
      conflict: true,
      applied: false,
      imageUrl: "new-url",
    });
    expect(mocks.charge).toHaveBeenCalledOnce();
  });
});
