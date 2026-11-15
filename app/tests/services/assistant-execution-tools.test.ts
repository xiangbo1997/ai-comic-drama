import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  scene: vi.fn(),
  configRow: vi.fn(),
  find: vi.fn(),
  task: vi.fn(),
  image: vi.fn(),
  video: vi.fn(),
  llm: vi.fn(),
  submitImage: vi.fn(),
  submitVideo: vi.fn(),
  location: vi.fn(),
  review: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: mocks.project },
    scene: { findFirst: mocks.scene },
    userAIConfig: { findFirst: mocks.configRow },
    generationTask: { findFirst: mocks.find, findUnique: mocks.task },
  },
}));
vi.mock("@/lib/ai-config", () => ({
  getUserImageConfig: mocks.image,
  getUserVideoConfig: mocks.video,
  getUserLLMConfig: mocks.llm,
}));
vi.mock("@/lib/system-config", () => ({
  getSystemConfigs: async () => ({
    COST_IMAGE_NORMAL: 1,
    COST_IMAGE_WITH_REF: 3,
    COST_LOCATION_PLATE: 1,
  }),
  getVideoTierCosts: async () => ({ 5: 10, 10: 20, 15: 30 }),
}));
vi.mock("@/services/generation/jobs/image", () => ({
  submitImageJob: mocks.submitImage,
}));
vi.mock("@/services/generation/jobs/video", () => ({
  submitVideoJob: mocks.submitVideo,
}));
vi.mock("@/services/generation/jobs/operation", () => ({
  createGenerationJob: vi.fn(),
  claimGenerationJob: vi.fn(),
}));
vi.mock("@/services/assistant-execution/tool-locations", () => ({
  executeLocationTool: mocks.location,
}));
vi.mock("@/services/assistant-execution/tool-review", () => ({
  executeReviewTool: mocks.review,
}));
vi.mock(
  "@/services/generation",
  () => import("@/services/generation/video-segmenter")
);
vi.mock("@/services/agents/vision-reviewer", () => ({
  supportsVisionReview: () => true,
}));
vi.mock("@/lib/prompts", () => ({
  buildVideoScenePrompt: () => "video-prompt",
}));
import {
  describeAssistantCapabilities,
  executeAssistantAction,
  reconcileAssistantAction,
} from "@/services/assistant-execution/tools";
import type { AssistantActionInput } from "@/services/assistant-execution/tool-types";
const input: AssistantActionInput = {
  userId: "u1",
  projectId: "p1",
  runId: "run1",
  operationKey: "op1",
  kind: "image",
  targetId: "s1",
  maxCost: 3,
  options: {},
};
const task = (output: Record<string, unknown>, status = "COMPLETED") => ({
  id: "t1",
  status,
  cost: 3,
  projectId: "p1",
  input: { userId: "u1", executionRunId: "run1", operationKey: "op1" },
  output,
});
const scene = () => ({
  id: "s1",
  description: "两人交谈",
  duration: 3,
  imageUrl: null,
  videoUrl: null,
  videoLinkNext: false,
  sceneCharacters: [
    { character: { canonicalImageUrl: "character-ref", referenceImages: [] } },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue({
    id: "p1",
    style: "anime",
    aspectRatio: "9:16",
    scenes: [{ id: "s1", duration: 3 }],
  });
  mocks.scene.mockResolvedValue(scene());
  mocks.configRow.mockResolvedValue({ id: "c1" });
  mocks.find.mockResolvedValue(null);
  mocks.task.mockResolvedValue(task({ imageUrl: "generated", cost: 3 }));
  mocks.image.mockResolvedValue({
    apiKey: "private-image-key",
    model: "image-model",
    protocol: "openai",
  });
  mocks.video.mockResolvedValue({
    apiKey: "private-video-key",
    model: "video-model",
    protocol: "openai",
  });
  mocks.llm.mockResolvedValue({
    apiKey: "private-llm-key",
    model: "gpt-vision",
    protocol: "openai",
  });
  mocks.submitImage.mockResolvedValue({ taskId: "t1", cost: 3 });
  mocks.submitVideo.mockResolvedValue({ taskId: "t1", cost: 10 });
});
describe("server assistant generation adapters", () => {
  it("submits exactly one image through the shared job with server budget and CAS", async () => {
    const result = await executeAssistantAction(input);
    expect(mocks.submitImage).toHaveBeenCalledOnce();
    expect(mocks.submitImage.mock.calls[0]).toMatchObject([
      "u1",
      {
        sceneId: "s1",
        count: 1,
        referenceImages: ["character-ref"],
        iterate: false,
      },
      {
        operationKey: "op1",
        executionRunId: "run1",
        maxCost: 3,
        disableRetries: true,
        expectedSceneImageUrl: null,
      },
    ]);
    expect(result.actualCost).toBe(3);
  });
  it("skips existing assets without starting another paid job", async () => {
    mocks.scene.mockResolvedValue({
      ...scene(),
      imageUrl: "existing",
      videoUrl: "existing-video",
    });
    expect((await executeAssistantAction(input)).actualCost).toBe(0);
    expect(
      (await executeAssistantAction({ ...input, kind: "video" })).actualCost
    ).toBe(0);
    expect(mocks.submitImage).not.toHaveBeenCalled();
    expect(mocks.submitVideo).not.toHaveBeenCalled();
  });
  it("repair uses the current image as base and only an owned-project anchor", async () => {
    mocks.scene
      .mockResolvedValueOnce({ ...scene(), imageUrl: "old-image" })
      .mockResolvedValueOnce({ imageUrl: "anchor-image" });
    await executeAssistantAction({
      ...input,
      kind: "repair",
      note: "服装保持一致",
      anchorSceneId: "prev",
    });
    expect(mocks.scene.mock.calls[1][0].where).toEqual({
      id: "prev",
      projectId: "p1",
    });
    expect(mocks.submitImage.mock.calls[0]).toMatchObject([
      "u1",
      {
        iterate: true,
        referenceImages: ["old-image"],
        iterationAnchorUrl: "anchor-image",
      },
      { expectedSceneImageUrl: "old-image" },
    ]);
  });
  it("video generation receives cross-shot tail frame and null CAS", async () => {
    mocks.scene
      .mockResolvedValueOnce({
        ...scene(),
        imageUrl: "first",
        videoLinkNext: true,
      })
      .mockResolvedValueOnce({ imageUrl: "last" });
    mocks.task.mockResolvedValue(task({ videoUrl: "video", cost: 10 }));
    await executeAssistantAction({ ...input, kind: "video", maxCost: 10 });
    expect(mocks.submitVideo.mock.calls[0]).toMatchObject([
      "u1",
      { imageUrl: "first", lastFrameImage: "last", sceneId: "s1" },
      { expectedVideoUrl: null },
    ]);
  });
  it("completed receipts replay without submission and conflicts request review", async () => {
    mocks.find.mockResolvedValue(
      task({ imageUrl: "noncurrent", cost: 3, conflict: true })
    );
    const result = await executeAssistantAction(input);
    expect(result.requiresReview).toBe(true);
    expect(result.actualCost).toBe(3);
    expect(mocks.submitImage).not.toHaveBeenCalled();
  });
  it("unknown upstream outcomes cannot be submitted again", async () => {
    mocks.find.mockResolvedValue(task({ unknown: true }, "FAILED"));
    expect((await reconcileAssistantAction(input)).status).toBe("unknown");
    await expect(executeAssistantAction(input)).rejects.toThrow(
      "上游执行结果尚未确认"
    );
    expect(mocks.submitImage).not.toHaveBeenCalled();
  });
  it("rejects foreign configuration before starting any job", async () => {
    mocks.configRow.mockResolvedValue(null);
    await expect(
      executeAssistantAction({
        ...input,
        options: { imageConfigId: "foreign" },
      })
    ).rejects.toThrow("模型配置不可用");
    expect(mocks.submitImage).not.toHaveBeenCalled();
  });
  it("fingerprints credentials without exposing them and changes when credentials change", async () => {
    const first = await describeAssistantCapabilities({
      userId: "u1",
      projectId: "p1",
      options: {},
    });
    expect(first.imageMaxCost).toBe(3);
    expect(first.canRepair).toBe(true);
    expect(JSON.stringify(first)).not.toContain("private-image-key");
    mocks.image.mockResolvedValue({
      apiKey: "changed-key",
      model: "image-model",
      protocol: "openai",
    });
    const changed = await describeAssistantCapabilities({
      userId: "u1",
      projectId: "p1",
      options: {},
    });
    expect(changed.configFingerprint).not.toBe(first.configFingerprint);
  });
  it("does not accept a receipt from another user's run", async () => {
    mocks.task.mockResolvedValue({
      ...task({}),
      input: { userId: "u2", executionRunId: "run1", operationKey: "op1" },
    });
    expect((await reconcileAssistantAction(input, "foreign-task")).status).toBe(
      "unknown"
    );
  });
});
