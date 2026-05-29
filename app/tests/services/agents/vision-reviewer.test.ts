import { describe, it, expect, vi, afterEach } from "vitest";
import { reviewImageWithVision } from "@/services/agents/vision-reviewer";
import type { AIServiceConfig } from "@/types";

const llmConfig: AIServiceConfig = {
  apiKey: "test",
  baseUrl: "https://api.test/v1",
  model: "gpt-4o-mini",
  protocol: "openai",
};

const baseArgs = {
  imageUrl: "https://cdn/gen.png",
  sceneDescription: "雨夜街头",
  characterDescriptions: "林萧: black hair, red coat",
  expectedEmotion: "tense",
  expectedShotType: "近景",
  llmConfig,
};

function mockFetchOnce(content: string, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  }) as unknown as typeof fetch;
}

describe("reviewImageWithVision()", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("解析合法的 ObserverVerdict JSON", async () => {
    const verdict = {
      pass: true,
      score: {
        overall: 82,
        dimensions: { scene_match: 85, character_consistency: 80 },
        pass: true,
        feedback: "ok",
      },
      retryable: false,
      suggestions: [],
    };
    mockFetchOnce("```json\n" + JSON.stringify(verdict) + "\n```");

    const r = await reviewImageWithVision(baseArgs);

    expect(r.pass).toBe(true);
    expect(r.score.overall).toBe(82);
  });

  it("发送的请求 content 含 image_url part", async () => {
    mockFetchOnce(
      JSON.stringify({
        pass: true,
        score: { overall: 70, dimensions: {}, pass: true },
        retryable: false,
        suggestions: [],
      })
    );

    await reviewImageWithVision(baseArgs);

    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const body = JSON.parse(call[1].body as string);
    const userContent = body.messages[1].content;
    expect(Array.isArray(userContent)).toBe(true);
    const imagePart = userContent.find(
      (p: { type: string }) => p.type === "image_url"
    );
    expect(imagePart.image_url.url).toBe("https://cdn/gen.png");
  });

  it("HTTP 非 OK 时抛出（供调用方降级）", async () => {
    mockFetchOnce("", false, 502);
    await expect(reviewImageWithVision(baseArgs)).rejects.toThrow(/HTTP 502/);
  });

  it("响应无 JSON 时抛出", async () => {
    mockFetchOnce("抱歉我无法评审");
    await expect(reviewImageWithVision(baseArgs)).rejects.toThrow(/no JSON/);
  });
});
