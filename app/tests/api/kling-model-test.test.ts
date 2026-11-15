import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  safe: vi.fn(),
  test: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { userAIConfig: { findFirst: mocks.find, update: mocks.update } },
}));
vi.mock("@/lib/url-guard", () => ({ assertSafeUrl: mocks.safe }));
vi.mock("@/services/ai/connectivity-test", () => ({
  testProviderConnectivity: mocks.test,
}));
import { POST } from "@/app/api/ai-models/configs/[id]/test/route";
import { encrypt, encryptExtraConfig, maskApiKey } from "@/lib/encryption";
const { encrypted, iv } = encrypt("saved-access-key");
const secretKey = "saved-secret-key-value";
const config = {
  id: "kling-config",
  apiKey: encrypted,
  apiKeyIv: iv,
  selectedModel: "kling-v2-6",
  customBaseUrl: null,
  apiProtocol: "kling",
  extraConfig: encryptExtraConfig({ secretKey, mode: "std" }),
  provider: {
    category: "VIDEO",
    slug: "kling",
    apiProtocol: "kling",
    baseUrl: "https://api-beijing.klingai.com",
  },
};
const call = (body: unknown) =>
  POST(
    new Request("https://app.example/api/ai-models/configs/kling-config/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "kling-config" }) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
  mocks.find.mockResolvedValue(config);
  mocks.safe.mockResolvedValue(undefined);
  mocks.test.mockResolvedValue({ success: true, message: "仅验证任务列表" });
  mocks.update.mockResolvedValue({});
});
describe("Kling saved config probe credentials", () => {
  it("decrypts stored keys, preserves masked fields and scopes lookup to owner", async () => {
    const response = await call({
      extraConfig: { secretKey: maskApiKey(secretKey), mode: "std" },
    });
    expect(response.status).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "kling-config", userId: "owner" },
      })
    );
    expect(mocks.test).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "saved-access-key",
        extraConfig: { secretKey, mode: "std" },
      })
    );
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain(secretKey);
  });
  it.each([
    { extraConfig: { secretKey: "edited-secret" } },
    { apiKey: "new-api-key", extraConfig: { secretKey: "" } },
    { extraConfig: { mode: "pro" } },
  ])(
    "tests edited credentials without marking the saved config successful %#",
    async (body) => {
      expect((await call(body)).status).toBe(200);
      expect(mocks.test).toHaveBeenCalledOnce();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.test.mock.calls[0][0]).toMatchObject({
        apiKey: "apiKey" in body ? body.apiKey : "saved-access-key",
        extraConfig: { mode: "std", ...body.extraConfig },
      });
    }
  );
  it.each([
    { extraConfig: { secretKey: 42 } },
    { apiKey: "" },
    { apiProtocol: "unknown" },
  ])("rejects invalid body %# before reading secrets", async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.test).not.toHaveBeenCalled();
  });
  it("rejects another user's config", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await call({})).status).toBe(404);
    expect(mocks.test).not.toHaveBeenCalled();
  });
});
