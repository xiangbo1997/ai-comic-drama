import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ai-models/configs/[id]/test/route";
const { authMock, findMock, updateMock, safeMock, testMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    findMock: vi.fn(),
    updateMock: vi.fn(),
    safeMock: vi.fn(),
    testMock: vi.fn(),
  })
);
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: { userAIConfig: { findFirst: findMock, update: updateMock } },
}));
vi.mock("@/lib/encryption", () => ({
  decrypt: () => "test-only-key",
  decryptExtraConfig: () => null,
}));
vi.mock("@/lib/url-guard", () => ({ assertSafeUrl: safeMock }));
vi.mock("@/services/ai/connectivity-test", () => ({
  testProviderConnectivity: testMock,
}));
const config = {
  id: "config-tts",
  apiKey: "encrypted",
  apiKeyIv: "iv",
  selectedModel: "grok-voice-latest",
  customBaseUrl: "https://grok2api.example/v1",
  apiProtocol: "openai",
  extraConfig: null,
  provider: {
    category: "TTS",
    slug: "custom-grok",
    apiProtocol: "gpt-sovits",
    baseUrl: "https://provider.example/v1",
  },
};
const call = (body: unknown) =>
  POST(
    new Request("https://app.example/api/ai-models/configs/config-tts/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "config-tts" }) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "owner" } });
  findMock.mockResolvedValue(config);
  safeMock.mockResolvedValue(undefined);
  testMock.mockResolvedValue({
    success: true,
    message: "模型已登记；未执行真实语音合成",
  });
  updateMock.mockResolvedValue({});
});
describe("已有Key的语音配置测试", () => {
  it("未保存表单的测试不改写原配置测试状态", async () => {
    await call({ apiProtocol: "grok" });
    expect(updateMock).not.toHaveBeenCalled();
  });
  it("不输入新Key也使用当前表单Grok协议，查找限定当前用户", async () => {
    const response = await call({
      apiProtocol: "grok",
      modelId: "grok-voice-think-fast-1.0",
    });
    expect(response.status).toBe(200);
    expect(findMock).toHaveBeenCalledWith({
      where: { id: "config-tts", userId: "owner" },
      include: { provider: true },
    });
    expect(testMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiProtocol: "grok",
        modelId: "grok-voice-think-fast-1.0",
        apiKey: "test-only-key",
      })
    );
  });
  it("省略协议时仍用原保存协议", async () => {
    await call({});
    expect(testMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiProtocol: "openai" })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "config-tts" },
        data: expect.objectContaining({ testStatus: "SUCCESS" }),
      })
    );
  });
  it("未知协议400且不发请求", async () => {
    expect((await call({ apiProtocol: "made-up" })).status).toBe(400);
    expect(testMock).not.toHaveBeenCalled();
  });
  it("未登录401且不读取密钥", async () => {
    authMock.mockResolvedValue(null);
    expect((await call({ apiProtocol: "grok" })).status).toBe(401);
    expect(findMock).not.toHaveBeenCalled();
  });
  it("其他用户配置404且不调用上游", async () => {
    findMock.mockResolvedValue(null);
    expect((await call({ apiProtocol: "grok" })).status).toBe(404);
    expect(testMock).not.toHaveBeenCalled();
  });
  it("Base URL未通过安全校验400且不调用上游", async () => {
    safeMock.mockRejectedValue(new Error("private address"));
    expect(
      (await call({ apiProtocol: "grok", customBaseUrl: "http://127.0.0.1" }))
        .status
    ).toBe(400);
    expect(testMock).not.toHaveBeenCalled();
  });
});
