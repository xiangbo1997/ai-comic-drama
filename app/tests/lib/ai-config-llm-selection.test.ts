import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  decrypt: vi.fn(() => "decrypted"),
  safe: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { userAIConfig: { findFirst: mocks.find } },
}));
vi.mock("@/lib/encryption", () => ({
  decrypt: mocks.decrypt,
  decryptExtraConfig: (value: unknown) => value,
}));
vi.mock("@/lib/url-guard", () => ({ assertSafeUrl: mocks.safe }));
import { getUserLLMConfig, getUserVideoConfig } from "@/lib/ai-config";
const config = () => ({
  id: "c1",
  userId: "u1",
  apiKey: "encrypted",
  apiKeyIv: "iv",
  customBaseUrl: null,
  apiProtocol: "openai",
  selectedModel: "original",
  authType: "API_KEY",
  extraConfig: {},
  customModels: [{ id: "custom", protocol: "claude" }],
  provider: {
    slug: "openai",
    baseUrl: "https://api.example.com/v1",
    apiProtocol: "openai",
    models: [{ id: "gpt-listed" }],
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(config());
});
describe("LLM configuration selection", () => {
  it("keeps the existing default behavior", async () => {
    expect(await getUserLLMConfig("u1")).toMatchObject({
      model: "original",
      apiKey: "decrypted",
    });
    expect(mocks.find.mock.calls[0][0].where).not.toHaveProperty("id");
  });
  it("scopes explicit configuration to current user's enabled LLM provider", async () => {
    expect(await getUserLLMConfig("u1", "c1", "gpt-listed")).toMatchObject({
      model: "gpt-listed",
    });
    expect(mocks.find.mock.calls[0][0].where).toMatchObject({
      id: "c1",
      userId: "u1",
      isEnabled: true,
      provider: { category: "LLM", isActive: true },
    });
  });
  it("rejects unknown/other user's config without falling back", async () => {
    mocks.find.mockResolvedValue(null);
    await expect(getUserLLMConfig("u1", "foreign")).rejects.toThrow();
    expect(mocks.find).toHaveBeenCalledTimes(1);
  });
  it("rejects arbitrary model overrides and never decrypts them", async () => {
    await expect(getUserLLMConfig("u1", "c1", "not-allowed")).rejects.toThrow();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("accepts the current saved model even when legacy model lists are empty", async () => {
    mocks.find.mockResolvedValue({
      ...config(),
      selectedModel: "gpt-6-sol",
      customModels: [],
      provider: { ...config().provider, models: [] },
    });
    expect(await getUserLLMConfig("u1", "c1", "gpt-6-sol")).toMatchObject({
      model: "gpt-6-sol",
      protocol: "openai",
      apiKey: "decrypted",
    });
    await expect(getUserLLMConfig("u1", "c1", "other-model")).rejects.toThrow();
  });
  it("supports listed custom models with their protocol and URL guard", async () => {
    mocks.find.mockResolvedValue({
      ...config(),
      customBaseUrl: "https://proxy.example.com",
    });
    expect(await getUserLLMConfig("u1", "c1", "custom")).toMatchObject({
      model: "custom",
      protocol: "claude",
    });
    expect(mocks.safe).toHaveBeenCalledWith("https://proxy.example.com");
  });
});

describe("Kling legacy video configuration", () => {
  it("resolves missing protocol by provider slug and retains extra credentials", async () => {
    const saved = config();
    mocks.find.mockResolvedValue({
      ...saved,
      apiProtocol: null,
      selectedModel: "kling-v1.5",
      extraConfig: {
        secretKey: "decrypted-secret",
        accessKey: "legacy-access",
      },
      provider: { ...saved.provider, slug: "kling", apiProtocol: null },
    });
    expect(await getUserVideoConfig("u1")).toMatchObject({
      protocol: "kling",
      model: "kling-v1.5",
      extraConfig: { secretKey: "decrypted-secret" },
    });
  });
  it("honors an explicit proxy protocol on the Kling preset", async () => {
    const saved = config();
    mocks.find.mockResolvedValue({
      ...saved,
      apiProtocol: "proxy-unified",
      provider: { ...saved.provider, slug: "kling", apiProtocol: "kling" },
    });
    expect(await getUserVideoConfig("u1")).toMatchObject({
      protocol: "proxy-unified",
    });
  });
});
