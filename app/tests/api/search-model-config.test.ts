import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  many: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userAIConfig: { findFirst: m.find, update: m.update, updateMany: m.many },
  },
}));
vi.mock("@/lib/encryption", () => ({
  encrypt: () => ({ encrypted: "enc", iv: "iv" }),
  decrypt: () => "test-key",
  maskApiKey: () => "test****",
  encryptExtraConfig: (v: unknown) => v,
  decryptExtraConfig: (v: unknown) => v,
  isSensitiveExtraKey: () => false,
}));
import { PUT } from "@/app/api/ai-models/configs/[id]/route";
const row = () => ({
  id: "search-config",
  apiKey: "enc",
  apiKeyIv: "iv",
  selectedModel: "search-model",
  apiProtocol: "openai",
  customBaseUrl: null,
  extraConfig: { webSearchTransport: "responses", unrelated: "preserve" },
  provider: { category: "LLM", apiProtocol: "openai" },
});
const put = (body: unknown) =>
  PUT(
    new Request("https://app.example/api/ai-models/configs/search-config", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "search-config" }) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "owner" } });
  m.find.mockResolvedValue(row());
  m.update.mockResolvedValue({ id: "search-config" });
});
describe("shared search model configuration", () => {
  it("requires ownership and rejects invalid capability or incompatible protocols", async () => {
    m.find.mockResolvedValue(null);
    expect(
      (await put({ extraConfig: { webSearchTransport: "responses" } })).status
    ).toBe(404);
    m.find.mockResolvedValue(row());
    expect(
      (await put({ extraConfig: { webSearchTransport: "invented" } })).status
    ).toBe(400);
    expect((await put({ apiProtocol: "claude" })).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.find).toHaveBeenCalledWith({
      where: { id: "search-config", userId: "owner" },
      include: { provider: true },
    });
  });
  it("changing capability or model invalidates old connectivity evidence", async () => {
    expect(
      (await put({ extraConfig: { webSearchTransport: "off" } })).status
    ).toBe(200);
    expect(m.update).toHaveBeenLastCalledWith({
      where: { id: "search-config" },
      data: expect.objectContaining({
        testStatus: null,
        lastTestedAt: null,
        extraConfig: { webSearchTransport: "off", unrelated: "preserve" },
      }),
    });
    await put({ selectedModel: "new-model" });
    expect(m.update).toHaveBeenLastCalledWith({
      where: { id: "search-config" },
      data: expect.objectContaining({ testStatus: null }),
    });
  });
  it("preserves capability and previous test when editing unrelated metadata", async () => {
    await put({ extraConfig: { note: "new" } });
    const data = m.update.mock.calls[0][0].data;
    expect(data.extraConfig).toEqual({
      webSearchTransport: "responses",
      unrelated: "preserve",
      note: "new",
    });
    expect(data.testStatus).toBeUndefined();
  });
});
