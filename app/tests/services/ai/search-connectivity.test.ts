import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/services/ai/web-search", () => ({ searchWebWithModel: m.search }));
import { testProviderConnectivity } from "@/services/ai/connectivity-test";
const config = {
  category: "LLM" as const,
  slug: "custom-search",
  apiKey: "test-only",
  baseUrl: "https://search.example/v1",
  modelId: "configured-model",
  apiProtocol: "openai",
  extraConfig: { webSearchTransport: "responses" },
};
beforeEach(() => vi.clearAllMocks());
describe("search capability test in the shared model module", () => {
  it("requires real native search evidence rather than a model listing or ordinary chat", async () => {
    m.search.mockResolvedValue({
      toolCalls: 2,
      sources: [{ url: "https://source.example/" }],
    });
    expect(await testProviderConnectivity(config)).toMatchObject({
      success: true,
      message: expect.stringContaining("联网搜索实测通过"),
    });
    expect(m.search).toHaveBeenCalledWith(
      expect.objectContaining({ model: config.modelId, apiKey: config.apiKey }),
      expect.any(String)
    );
  });
  it("does not mark an unsupported search result as verified", async () => {
    m.search.mockRejectedValue(new Error("模型未返回搜索工具记录"));
    expect(await testProviderConnectivity(config)).toMatchObject({
      success: false,
    });
    expect(
      await testProviderConnectivity({ ...config, apiProtocol: "claude" })
    ).toMatchObject({ success: false, errorType: "config" });
  });
});
