import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/services/agents/types";

vi.mock("@/services/ai", () => ({ chatCompletion: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

import { chatCompletion } from "@/services/ai";
import {
  reviewStoryboard,
  reviewVideoSequence,
} from "@/services/agents/narrative-observer";

const ctx = {
  config: {
    llm: {
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      model: "test-model",
      protocol: "openai",
    },
  },
} as WorkflowContext;

const narrativeDimensions = {
  narrative_flow: 80,
  character_continuity: 70,
  visual_diversity: 60,
  hook_strength: 90,
  cliffhanger: 50,
  externalization: 40,
};
const videoDimensions = {
  transition_flow: 80,
  motion_continuity: 70,
  pacing: 60,
};

function response(dimensions: Record<string, unknown>, pass = true) {
  return {
    pass,
    score: { overall: 100, dimensions, pass },
    retryable: true,
    suggestions: ["调整第 1 镜"],
  };
}

beforeEach(() => vi.mocked(chatCompletion).mockReset());

describe("narrative observer: server-calculated scores", () => {
  it("recalculates the six narrative weights and both pass flags", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      JSON.stringify(response(narrativeDimensions))
    );

    const result = await reviewStoryboard([], ctx);

    expect(result?.score.overall).toBeCloseTo(67);
    expect(result?.pass).toBe(false);
    expect(result?.score.pass).toBe(false);
    expect(result?.retryable).toBe(true);
    expect(result?.suggestions).toEqual(["调整第 1 镜"]);
  });

  it("recalculates the video weights despite the model rejecting the result", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      JSON.stringify(response(videoDimensions, false))
    );

    const result = await reviewVideoSequence([], ctx);

    expect(result?.score.overall).toBeCloseTo(71.5);
    expect(result?.pass).toBe(true);
    expect(result?.score.pass).toBe(true);
  });

  it.each([
    ["narrative", reviewStoryboard, narrativeDimensions, "externalization", 39],
    ["video", reviewVideoSequence, videoDimensions, "pacing", 34],
  ] as const)(
    "rejects a high aggregate with a failing %s dimension",
    async (_label, review, dimensions, weakKey, weakScore) => {
      const scores = Object.fromEntries(
        Object.keys(dimensions).map((key) => [key, 100])
      );
      scores[weakKey] = weakScore;
      vi.mocked(chatCompletion).mockResolvedValueOnce(
        JSON.stringify(response(scores))
      );

      const result = await review([], ctx);

      expect(result?.score.overall).toBeGreaterThan(80);
      expect(result?.pass).toBe(false);
      expect(result?.score.pass).toBe(false);
    }
  );

  it.each([
    ["narrative", reviewStoryboard, narrativeDimensions, 70, true],
    ["narrative", reviewStoryboard, narrativeDimensions, 69.99, false],
    ["video", reviewVideoSequence, videoDimensions, 60, true],
    ["video", reviewVideoSequence, videoDimensions, 59.99, false],
  ] as const)(
    "%s threshold uses the unrounded result (case %#)",
    async (_label, review, dimensions, score, expected) => {
      const scores = Object.fromEntries(
        Object.keys(dimensions).map((key) => [key, score])
      );
      vi.mocked(chatCompletion).mockResolvedValueOnce(
        JSON.stringify(response(scores, !expected))
      );

      const result = await review([], ctx);

      expect(result?.score.overall).toBeCloseTo(score);
      expect(result?.pass).toBe(expected);
      expect(result?.score.pass).toBe(expected);
    }
  );

  it.each([
    [reviewStoryboard, narrativeDimensions, "externalization", 40],
    [reviewVideoSequence, videoDimensions, "pacing", 35],
  ] as const)(
    "accepts a dimension at the inclusive floor",
    async (review, dimensions, key, floor) => {
      const scores = Object.fromEntries(
        Object.keys(dimensions).map((name) => [name, 100])
      );
      scores[key] = floor;
      vi.mocked(chatCompletion).mockResolvedValueOnce(
        JSON.stringify(response(scores, false))
      );

      const result = await review([], ctx);

      expect(result?.pass).toBe(true);
      expect(result?.score.pass).toBe(true);
    }
  );

  it.each([0, 100])("accepts valid score boundary %s", async (score) => {
    const scores = Object.fromEntries(
      Object.keys(narrativeDimensions).map((key) => [key, score])
    );
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      JSON.stringify(response(scores))
    );

    const result = await reviewStoryboard([], ctx);

    expect(result?.score.overall).toBe(score);
    expect(result?.pass).toBe(score === 100);
  });

  it("preserves optional feedback and ignores unknown valid dimensions", async () => {
    const value = response({ ...videoDimensions, unsupported_metric: 100 });
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      JSON.stringify({
        ...value,
        score: { ...value.score, feedback: "有依据" },
      })
    );

    const result = await reviewVideoSequence([], ctx);

    expect(result?.score.feedback).toBe("有依据");
    expect(result?.score.dimensions).toEqual(videoDimensions);
    expect(result?.score.overall).toBe(71.5);
  });

  it("does not require unused model aggregate or pass fields", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      JSON.stringify({
        score: { dimensions: videoDimensions },
        retryable: false,
        suggestions: [],
      })
    );

    const result = await reviewVideoSequence([], ctx);

    expect(result?.pass).toBe(true);
    expect(result?.score.pass).toBe(true);
    expect(result?.score.feedback).toBeUndefined();
  });
});

describe("narrative observer: invalid review evidence", () => {
  it.each([
    [reviewStoryboard, narrativeDimensions],
    [reviewVideoSequence, videoDimensions],
  ] as const)("rejects missing required dimensions", async (review, scores) => {
    const dimensions: Record<string, number> = { ...scores };
    delete dimensions[Object.keys(dimensions)[0]];
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      JSON.stringify(response(dimensions))
    );

    expect(await review([], ctx)).toBeNull();
  });

  it.each([-1, 101, "80", null])(
    "rejects invalid dimension score %s",
    async (invalid) => {
      vi.mocked(chatCompletion).mockResolvedValueOnce(
        JSON.stringify(
          response({ ...narrativeDimensions, hook_strength: invalid })
        )
      );

      expect(await reviewStoryboard([], ctx)).toBeNull();
    }
  );

  it("rejects a non-finite numeric dimension", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      JSON.stringify(response(videoDimensions)).replace(
        '"pacing":60',
        '"pacing":1e309'
      )
    );

    expect(await reviewVideoSequence([], ctx)).toBeNull();
  });

  it("returns null when the model fails", async () => {
    vi.mocked(chatCompletion).mockRejectedValueOnce(new Error("offline"));
    expect(await reviewStoryboard([], ctx)).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce("无法评审");
    expect(await reviewVideoSequence([], ctx)).toBeNull();
  });

  it("skips the request when no model is configured", async () => {
    expect(
      await reviewStoryboard([], { config: {} } as WorkflowContext)
    ).toBeNull();
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
