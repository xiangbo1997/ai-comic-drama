import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ScriptArtifact,
  StoryboardArtifact,
  WorkflowContext,
} from "@/services/agents/types";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  review: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/services/agents/storyboard-agent", () => ({
  StoryboardAgent: class {},
}));
vi.mock("@/services/agents/workflow/context", () => ({
  executeAgentStep: mocks.execute,
}));
vi.mock("@/services/agents/workflow/steps/review", () => ({
  reviewStoryboardCoherence: mocks.review,
}));
vi.mock("@/services/agents/workflow/scene-persistence", () => ({
  saveScenesToProject: mocks.save,
}));
import { runStoryboardStep } from "@/services/agents/workflow/steps/storyboard";

const script = {
  title: "旧宅",
  characters: [],
  scenes: [
    {
      id: 10,
      shotType: "中景",
      description: "原版描述",
      characters: ["阿宁"],
      dialogue: null,
      narration: "原旁白",
      duration: 4,
      emotion: "neutral",
      linkNext: true,
      locationKey: "旧宅",
      cameraAngle: "low-angle",
    },
  ],
} as ScriptArtifact;
const reviewed: StoryboardArtifact = {
  scenes: [
    {
      id: 1,
      order: 1,
      shotType: "特写",
      description: "评审后定稿描述",
      imagePrompt: "final visual prompt",
      characters: ["阿宁"],
      dialogue: "别开门！",
      narration: null,
      duration: 3,
      emotion: "fear",
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ success: true, data: { scenes: [] } });
  mocks.review.mockResolvedValue(reviewed);
  mocks.save.mockResolvedValue(undefined);
});

describe("分镜定稿落库", () => {
  it("发布定稿artifact前持久化评审采用的正文，复用原镜元数据", async () => {
    const set = vi.fn();
    const ctx = {
      projectId: "project-a",
      artifacts: { set },
    } as unknown as WorkflowContext;
    expect(await runStoryboardStep(script, { characters: [] }, ctx)).toBe(
      reviewed
    );
    expect(mocks.save).toHaveBeenCalledWith(
      "project-a",
      expect.objectContaining({
        scenes: [
          expect.objectContaining({
            description: "评审后定稿描述",
            dialogue: "别开门！",
            narration: null,
            duration: 3,
            linkNext: true,
            locationKey: "旧宅",
            cameraAngle: "low-angle",
          }),
        ],
      })
    );
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      set.mock.invocationCallOrder[0]
    );
  });
  it("持久化失败时停止后续生成，不发布看似已同步的定稿", async () => {
    mocks.save.mockRejectedValue(new Error("写入失败"));
    const set = vi.fn();
    const ctx = {
      projectId: "project-a",
      artifacts: { set },
    } as unknown as WorkflowContext;
    await expect(
      runStoryboardStep(script, { characters: [] }, ctx)
    ).rejects.toThrow("写入失败");
    expect(set).not.toHaveBeenCalled();
  });
});
