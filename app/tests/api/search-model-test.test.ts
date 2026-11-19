import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  test: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userAIConfig: {
      findFirst: m.find,
      update: m.update,
      updateMany: m.updateMany,
    },
  },
}));
vi.mock("@/lib/encryption", () => ({
  decrypt: () => "test-only",
  decryptExtraConfig: (v: unknown) => v,
  maskApiKey: (v: unknown) => v,
  isSensitiveExtraKey: () => false,
}));
vi.mock("@/lib/url-guard", () => ({ assertSafeUrl: vi.fn() }));
vi.mock("@/services/ai/connectivity-test", () => ({
  testProviderConnectivity: m.test,
}));
import { POST } from "@/app/api/ai-models/configs/[id]/test/route";
const config = {
  id: "search-config",
  apiKey: "encrypted",
  apiKeyIv: "iv",
  selectedModel: "search-model",
  customBaseUrl: null,
  apiProtocol: "openai",
  extraConfig: { webSearchTransport: "responses" },
  updatedAt: new Date("2026-11-19T00:00:00Z"),
  provider: {
    category: "LLM",
    slug: "custom-search",
    baseUrl: "https://search.example/v1",
    apiProtocol: "openai",
    updatedAt: new Date("2026-11-18T00:00:00Z"),
  },
};
const call = () =>
  POST(
    new Request(
      "https://app.example/api/ai-models/configs/search-config/test",
      { method: "POST", body: "{}" }
    ),
    { params: Promise.resolve({ id: "search-config" }) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "owner" } });
  m.find.mockResolvedValue(config);
  m.test.mockResolvedValue({ success: true, message: "真实搜索通过" });
});
describe("fenced search capability verification", () => {
  it("stores proof only for the owned configuration and provider revision actually tested", async () => {
    m.updateMany.mockResolvedValue({ count: 1 });
    expect(await (await call()).json()).toMatchObject({
      success: true,
      verificationStored: true,
    });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: {
        id: config.id,
        userId: "owner",
        updatedAt: config.updatedAt,
        provider: { updatedAt: config.provider.updatedAt },
      },
      data: { testStatus: "SUCCESS", lastTestedAt: expect.any(Date) },
    });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("does not mark a configuration changed during the request as verified", async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    expect(await (await call()).json()).toMatchObject({
      success: false,
      verificationStored: false,
      message: expect.stringContaining("配置已变化"),
    });
    expect(m.update).not.toHaveBeenCalled();
  });
});
