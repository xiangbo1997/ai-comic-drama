import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateFaceConsistency,
  clearFaceValidationMemo,
} from "@/services/generation/face-validator";
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
    // 相似度记忆表是模块级进程内状态：不清会让后一个用例命中前一个用例
    // 缓存的分数（本文件多个用例共用同一组 图片/参考图/角色/模型）。
    clearFaceValidationMemo();
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

  // 成本护栏：编排器在缓存命中路径与每次重试都会调本校验器，同图同角色的
  // 判断是确定的，重复评分纯属浪费 VLM token。
  it("memoizes score: same image+character 只调一次 VLM", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score": 0.9}' } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = "https://img/memo.png";
    const first = await validateFaceConsistency(url, [primaryChar], "特写", {
      llmConfig,
    });
    const second = await validateFaceConsistency(url, [primaryChar], "特写", {
      llmConfig,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.scores["林萧"]).toBeCloseTo(first.scores["林萧"], 5);
  });

  it("不同图片仍各自评分（新图必然 miss）", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score": 0.9}' } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await validateFaceConsistency("https://img/a.png", [primaryChar], "特写", {
      llmConfig,
    });
    await validateFaceConsistency("https://img/b.png", [primaryChar], "特写", {
      llmConfig,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
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
