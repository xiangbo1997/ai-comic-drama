import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import path from "path";
import {
  reviewImageWithVision,
  supportsVisionReview,
  resolveImageUrlForVision,
} from "@/services/agents/vision-reviewer";
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

describe("supportsVisionReview() · 门禁", () => {
  function cfg(over: Partial<AIServiceConfig>): AIServiceConfig {
    return {
      apiKey: "k",
      baseUrl: "https://api.test/v1",
      model: "gpt-4o",
      protocol: "openai",
      ...over,
    };
  }

  it("claude / gemini 协议 → 拒绝", () => {
    expect(supportsVisionReview(cfg({ protocol: "claude" }))).toBe(false);
    expect(supportsVisionReview(cfg({ protocol: "gemini" }))).toBe(false);
  });

  it("DeepSeek（openai 协议但纯文本模型）→ 拒绝（假绿 A 根因）", () => {
    expect(
      supportsVisionReview(cfg({ protocol: "openai", model: "deepseek-chat" }))
    ).toBe(false);
    expect(
      supportsVisionReview(
        cfg({ protocol: "openai", model: "deepseek-reasoner" })
      )
    ).toBe(false);
  });

  it("其他已知纯文本模型（gpt-3.5 / moonshot）→ 拒绝", () => {
    expect(supportsVisionReview(cfg({ model: "gpt-3.5-turbo" }))).toBe(false);
    expect(supportsVisionReview(cfg({ model: "moonshot-v1-8k" }))).toBe(false);
  });

  it("多模态 gpt-4o / 未知 openai 模型 → 放行（诚实报告兜底）", () => {
    expect(supportsVisionReview(cfg({ model: "gpt-4o" }))).toBe(true);
    expect(supportsVisionReview(cfg({ model: "gpt-4.1" }))).toBe(true);
    expect(supportsVisionReview(cfg({ model: "some-new-vlm" }))).toBe(true);
  });
});

describe("resolveImageUrlForVision() · 本地路径内联", () => {
  it("http(s) URL → 原样返回（外部可达）", async () => {
    expect(await resolveImageUrlForVision("https://cdn/x.png")).toBe(
      "https://cdn/x.png"
    );
    expect(await resolveImageUrlForVision("http://cdn/x.png")).toBe(
      "http://cdn/x.png"
    );
  });

  it("data: URL → 原样返回", async () => {
    const dataUrl = "data:image/png;base64,AAA";
    expect(await resolveImageUrlForVision(dataUrl)).toBe(dataUrl);
  });

  it("非 /uploads 前缀的相对路径 → null（不猜测）", async () => {
    expect(await resolveImageUrlForVision("/etc/passwd")).toBeNull();
    expect(await resolveImageUrlForVision("relative/path.png")).toBeNull();
  });

  it("路径穿越 → null", async () => {
    expect(
      await resolveImageUrlForVision("/uploads/../../../etc/passwd")
    ).toBeNull();
  });

  describe("真实读盘（写入默认 public/uploads 临时子目录）", () => {
    // 模块用默认 LOCAL_STORAGE_DIR=public/uploads、URL 前缀=/uploads（env 未设）
    const uploadsDir = path.resolve(process.cwd(), "public/uploads");
    let tmpDir = "";
    let subName = "";

    afterEach(async () => {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        tmpDir = "";
      }
    });

    async function makeUpload(
      fileName: string,
      bytes: Buffer
    ): Promise<string> {
      tmpDir = await mkdtemp(path.join(uploadsDir, "vtest-"));
      subName = path.basename(tmpDir);
      const filePath = path.join(tmpDir, fileName);
      await writeFile(filePath, bytes);
      return `/uploads/${subName}/${fileName}`;
    }

    it("本地 /uploads 图片 → 内联成 data URL（带正确 mime）", async () => {
      const url = await makeUpload("i.png", Buffer.from([1, 2, 3, 4]));
      const resolved = await resolveImageUrlForVision(url);
      expect(resolved).toMatch(/^data:image\/png;base64,/);
      // 4 字节 → base64 长度可解回
      const b64 = resolved!.split(",")[1];
      expect(Buffer.from(b64, "base64")).toEqual(Buffer.from([1, 2, 3, 4]));
    });

    it("文件不存在 → null（该对跳过）", async () => {
      // 建目录但不写该文件
      tmpDir = await mkdtemp(path.join(uploadsDir, "vtest-"));
      subName = path.basename(tmpDir);
      expect(
        await resolveImageUrlForVision(`/uploads/${subName}/missing.png`)
      ).toBeNull();
    });

    it("超过 4MB → null（不塞超大 payload）", async () => {
      const big = Buffer.alloc(4 * 1024 * 1024 + 1, 0);
      const url = await makeUpload("big.webp", big);
      expect(await resolveImageUrlForVision(url)).toBeNull();
    });

    it("非图片扩展名 → null（不内联）", async () => {
      const url = await makeUpload("note.txt", Buffer.from("hi"));
      expect(await resolveImageUrlForVision(url)).toBeNull();
    });
  });
});
