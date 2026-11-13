import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CharacterBible,
  ScriptArtifact,
  StoryboardArtifact,
  WorkflowContext,
} from "@/services/agents/types";

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  persist: vi.fn(),
  regenerate: vi.fn(),
}));
vi.mock("@/services/agents/character-bible-agent", () => ({
  CharacterBibleAgent: class {},
}));
vi.mock("@/services/agents/storyboard-agent", () => ({
  StoryboardAgent: class {
    run = mocks.regenerate;
  },
}));
vi.mock("@/services/agents/narrative-observer", () => ({
  reviewStoryboard: mocks.review,
  reviewVideoSequence: vi.fn(),
}));
vi.mock("@/services/agents/event-bus", () => ({ emitEvent: vi.fn() }));
vi.mock("@/services/agents/workflow/context", () => ({
  setReviewArtifact: mocks.persist,
  log: { info: vi.fn() },
}));

import { reviewStoryboardCoherence } from "@/services/agents/workflow/steps/review";

describe("工作流叙事评审数据传递", () => {
  beforeEach(() => vi.clearAllMocks());

  it("将生成后的台词、旁白、时长与动作送入评审，保留原分镜顺序", async () => {
    mocks.review.mockResolvedValue({
      pass: true,
      score: { overall: 90, dimensions: {}, pass: true },
      retryable: false,
      suggestions: [],
    });
    const first = {
      id: 12,
      order: 0,
      shotType: "特写",
      emotion: "fear",
      characters: ["阿宁"],
      description: "阿宁捂住门锁，望向窗外的黑影。",
      imagePrompt: "A woman holds the door lock",
      duration: 3,
      dialogue: "别进来！",
      narration: null,
      actionBeat: "捂住门锁",
      cameraMovement: "zoom_in",
    };
    const storyboard: StoryboardArtifact = { scenes: [first] };
    const ctx = {
      config: {
        closedLoops: {
          storyboard: { enabled: true, maxRounds: 0, passThreshold: 70 },
        },
      },
      emit: vi.fn(),
      workflowRunId: "test",
    } as unknown as WorkflowContext;
    const result = await reviewStoryboardCoherence(
      storyboard,
      {} as ScriptArtifact,
      { characters: [] } as CharacterBible,
      ctx
    );
    expect(result).toBe(storyboard);
    expect(mocks.review).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 12,
          duration: 3,
          dialogue: "别进来！",
          narration: null,
          actionBeat: "捂住门锁",
          cameraMovement: "zoom_in",
        }),
      ],
      ctx
    );
  });

  it("修订质量下降时，保存的诊断必须对应实际选用的最优版本", async () => {
    const original: StoryboardArtifact = { scenes: [] };
    const revised: StoryboardArtifact = { scenes: [] };
    const verdict = (overall: number, feedback: string) => ({
      pass: false,
      score: {
        overall,
        dimensions: { hook_strength: overall },
        pass: false,
        feedback,
      },
      retryable: true,
      suggestions: [feedback],
    });
    mocks.review
      .mockResolvedValueOnce(verdict(65, "原版待改善"))
      .mockResolvedValueOnce(verdict(40, "修订版更差"));
    mocks.regenerate.mockResolvedValue({ success: true, data: revised });
    const ctx = {
      config: {
        closedLoops: {
          storyboard: { enabled: true, maxRounds: 1, passThreshold: 70 },
        },
      },
      emit: vi.fn(),
      workflowRunId: "test",
    } as unknown as WorkflowContext;
    const result = await reviewStoryboardCoherence(
      original,
      {} as ScriptArtifact,
      { characters: [] },
      ctx
    );
    expect(result).toBe(original);
    expect(mocks.persist).toHaveBeenCalledWith(
      ctx,
      "storyboard",
      expect.objectContaining({
        score: 65,
        feedback: "原版待改善",
        suggestions: ["原版待改善"],
        dimensions: { hook_strength: 65 },
      })
    );
  });

  it("评审不可用时保留分镜供流程继续，但不得标记质量通过", async () => {
    mocks.review.mockResolvedValue(null);
    const storyboard: StoryboardArtifact = { scenes: [] };
    const ctx = {
      config: {
        closedLoops: {
          storyboard: { enabled: true, maxRounds: 1, passThreshold: 70 },
        },
      },
      emit: vi.fn(),
      workflowRunId: "test",
    } as unknown as WorkflowContext;
    expect(
      await reviewStoryboardCoherence(
        storyboard,
        {} as ScriptArtifact,
        { characters: [] },
        ctx
      )
    ).toBe(storyboard);
    expect(mocks.persist).toHaveBeenCalledWith(
      ctx,
      "storyboard",
      expect.objectContaining({
        pass: false,
        score: 0,
        feedback: expect.stringContaining("评审未完成"),
      })
    );
  });
});
