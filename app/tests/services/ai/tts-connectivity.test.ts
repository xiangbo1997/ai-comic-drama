import { beforeEach, describe, expect, it, vi } from "vitest";
import { testTTSModelListing } from "@/services/ai/connectivity-test-tts";
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: safeFetchMock }));
beforeEach(() => safeFetchMock.mockReset());
describe("语音测试诚实标明模型列表检查范围", () => {
  it("200网页不回显其内容或误报成功", async () => {
    safeFetchMock.mockResolvedValue(
      new Response("<html>private secret</html>")
    );
    const result = await testTTSModelListing("key", "https://example.com/v1");
    expect(result.success).toBe(false);
    expect(result.message).toContain("JSON");
    expect(result.message).not.toContain("private");
  });
  it.each([401, 403])("%s归类鉴权错误且不透传密钥", async (status) => {
    safeFetchMock.mockResolvedValue(
      new Response("secret upstream key", { status })
    );
    const result = await testTTSModelListing(
      "key",
      "https://example.com/v1",
      "chatgpt-tts"
    );
    expect(result.errorType).toBe("auth");
    expect(result.message).not.toContain("secret");
  });
  it("502网页不作为模型缺失且不回显网页", async () => {
    safeFetchMock.mockResolvedValue(
      new Response("<html>private</html>", { status: 502 })
    );
    const result = await testTTSModelListing("key", "https://example.com/v1");
    expect(result.errorType).toBe("network");
    expect(result.message).not.toContain("private");
  });
  it.each([
    { models: [{ id: "chatgpt-tts" }] },
    { data: ["chatgpt-tts"] },
    { data: [null, {}, 1, { id: 5 }, { id: "chatgpt-tts" }] },
  ])("兼容两种列表并忽略非法条目 %#", async (body) => {
    safeFetchMock.mockResolvedValue(Response.json(body));
    expect(
      (
        await testTTSModelListing(
          "key",
          "https://example.com/v1",
          "chatgpt-tts"
        )
      ).success
    ).toBe(true);
  });
  it.each([null, [], {}, "models"])(
    "模型列表结构错误%s不误报成功",
    async (body) => {
      safeFetchMock.mockResolvedValue(Response.json(body));
      expect(
        (
          await testTTSModelListing(
            "key",
            "https://example.com/v1",
            "chatgpt-tts"
          )
        ).errorType
      ).toBe("config");
    }
  );
  it("不指定模型仅验证列表连通", async () => {
    safeFetchMock.mockResolvedValue(Response.json({ data: [] }));
    const result = await testTTSModelListing("key", "https://example.com/v1/");
    expect(result.success).toBe(true);
    expect(result.message).toContain("未执行真实语音合成");
  });
});
