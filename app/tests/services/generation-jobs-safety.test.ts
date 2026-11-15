import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  background: [] as Promise<unknown>[],
  image: vi.fn(),
  video: vi.fn(),
  task: vi.fn(),
  scene: vi.fn(),
  persist: vi.fn(),
  charge: vi.fn(),
  claim: vi.fn(),
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    scene: { updateMany: mocks.scene },
    generationTask: { update: mocks.task },
  };
  return {
    prisma: {
      ...tx,
      user: { findUnique: async () => ({ credits: 100 }) },
      scene: {
        ...tx.scene,
        findFirst: async () => ({ id: "s1" }),
        findUnique: async () => null,
      },
      $transaction: (fn: (tx: unknown) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/content-safety", () => ({
  contentSafetyMiddleware: async () => ({ safe: true }),
}));
vi.mock("@/lib/ai-config", () => ({
  getUserImageConfig: async () => ({
    protocol: "openai",
    model: "test",
    apiKey: "test",
  }),
  getUserVideoConfig: async () => ({
    protocol: "runway",
    model: "test",
    apiKey: "test",
  }),
  getUserLLMConfig: async () => null,
}));
vi.mock("@/lib/system-config", () => ({
  getSystemConfigs: async () => ({
    COST_IMAGE_NORMAL: 1,
    COST_IMAGE_WITH_REF: 3,
  }),
  getVideoTierCosts: async () => ({}),
}));
vi.mock("@/services/storage", () => ({ isStorageConfigured: () => false }));
vi.mock("@/lib/credits", () => ({ chargeCredits: mocks.charge }));
vi.mock("@/services/generation", () => ({
  orchestrateImageGeneration: mocks.image,
  generateSceneVideoSegmented: mocks.video,
  normalizeCandidateCount: () => 1,
  pickRecommendedIndex: () => 0,
  scoreCandidate: async () => ({ vlmScore: null, vlmReason: null }),
  estimateVideoCost: () => 10,
  resolveFinalVideoCost: (estimated: number) => estimated,
  planVideoSegments: () => ({ segments: [{}] }),
  clampSceneDuration: () => 5,
}));
vi.mock("@/services/generation/image-request/persist", () => ({
  persistImageResult: mocks.persist,
}));
vi.mock("@/services/generation/jobs/operation", () => ({
  assertGenerationOwnership: vi.fn(),
  createGenerationJob: async () => ({ id: "t1" }),
  claimGenerationJob: mocks.claim,
}));
vi.mock("@/lib/generation-concurrency", () => ({
  runWithGenerationSlot: (_key: string, run: () => Promise<unknown>) => {
    const pending = run();
    mocks.background.push(pending);
    return pending;
  },
}));
vi.mock("@/services/video-synthesis", () => ({
  probeMediaDurationFromUrl: async () => 5,
}));
vi.mock("@/services/ai/video-capabilities", () => ({
  getVideoModelCapability: () => ({ supportsFirstLastFrame: true }),
}));

import { submitImageJob } from "@/services/generation/jobs/image";
import { submitVideoJob } from "@/services/generation/jobs/video";

const internal = {
  operationKey: "op1",
  executionRunId: "run1",
  maxCost: 10,
  disableRetries: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.background.length = 0;
  mocks.claim.mockResolvedValue(true);
  mocks.scene.mockResolvedValue({ count: 1 });
  mocks.persist.mockResolvedValue([]);
  mocks.image.mockResolvedValue({
    imageUrl: "generated-image",
    strategy: "prompt_only",
    attemptCount: 1,
  });
  mocks.video.mockResolvedValue({
    videoUrl: "generated-video",
    isSelfHosted: true,
    segments: [],
  });
});

describe("confirmed generation job safety", () => {
  it("image transport failures leave unknown receipts without charging or retrying", async () => {
    mocks.image.mockRejectedValue(new Error("network timeout"));
    await submitImageJob("u1", { prompt: "draw" }, internal);
    await Promise.all(mocks.background);
    expect(mocks.image).toHaveBeenCalledOnce();
    expect(mocks.image.mock.calls[0][0]).toMatchObject({
      maxRetries: 1,
      disableRetries: true,
      disableAuxiliaryGeneration: true,
    });
    expect(mocks.task.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      output: { unknown: true },
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("video transport failures leave unknown receipts and preserve changed user status", async () => {
    mocks.video.mockRejectedValue(new Error("upstream timeout"));
    await submitVideoJob(
      "u1",
      { prompt: "move", imageUrl: "image", projectId: "p1", sceneId: "s1" },
      { ...internal, expectedVideoUrl: null }
    );
    await Promise.all(mocks.background);
    expect(mocks.video).toHaveBeenCalledOnce();
    expect(mocks.task.mock.calls[0][0].data.output).toEqual({ unknown: true });
    expect(mocks.scene.mock.calls[1][0].where).toEqual({
      id: "s1",
      projectId: "p1",
      videoUrl: null,
    });
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("retains a successful video in its receipt when user selection conflicts and charges once", async () => {
    mocks.scene
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await submitVideoJob(
      "u1",
      { prompt: "move", imageUrl: "image", projectId: "p1", sceneId: "s1" },
      { ...internal, expectedVideoUrl: null }
    );
    await Promise.all(mocks.background);
    expect(mocks.task.mock.calls[0][0].data).toMatchObject({
      status: "COMPLETED",
      cost: 10,
      output: {
        videoUrl: "generated-video",
        cost: 10,
        conflict: true,
        applied: false,
      },
    });
    expect(mocks.charge).toHaveBeenCalledOnce();
  });

  it("does not call a paid provider when its receipt cannot be claimed", async () => {
    mocks.claim.mockResolvedValue(false);
    await submitImageJob("u1", { prompt: "draw" }, internal);
    await submitVideoJob("u1", { prompt: "move", imageUrl: "image" }, internal);
    await Promise.all(mocks.background);
    expect(mocks.image).not.toHaveBeenCalled();
    expect(mocks.video).not.toHaveBeenCalled();
    expect(mocks.task).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
  });
});
