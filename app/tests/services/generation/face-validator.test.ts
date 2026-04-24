import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateFaceConsistency } from "@/services/generation/face-validator";
import type { SceneCharacterInfo } from "@/services/generation/types";
import type { AIServiceConfig } from "@/types";

const llmConfig: AIServiceConfig = {
  apiKey: "test",
  baseUrl: "https://api.test/v1",
  model: "gpt-4o-mini",
  protocol: "openai",
};

const primaryChar: SceneCharacterInfo = {
  id: "c1",
  name: "林萧",
  gender: "female",
  age: "24",
  description: "24岁女性",
  referenceImages: ["https://cdn/ref.png"],
  role: "primary",
  canonicalImageUrl: "https://cdn/ref.png",
  appearance: null,
};

describe("validateFaceConsistency()", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("skips validation for 远景 (shouldRetry=false, passed=true)", async () => {
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "远景",
      { llmConfig }
    );
    expect(r.passed).toBe(true);
    expect(r.shouldRetry).toBe(false);
    expect(r.reason).toBe("validation_skipped_for_shot_type");
  });

  it("passes through when llmConfig is missing", async () => {
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写"
    );
    expect(r.passed).toBe(true);
    expect(r.reason).toBe("llm_config_missing");
  });

  it("returns passed=true when LLM similarity score >= threshold (0.8 for 特写)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"same": true, "score": 0.92, "reason": "ok"}',
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig }
    );
    expect(r.passed).toBe(true);
    expect(r.scores["林萧"]).toBeCloseTo(0.92, 2);
    expect(r.shouldRetry).toBe(false);
  });

  it("degrades to passthrough on malformed LLM response", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom"));

    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig }
    );
    expect(r.passed).toBe(true);
    expect(r.reason).toBe("llm_validation_error");
  });
});
