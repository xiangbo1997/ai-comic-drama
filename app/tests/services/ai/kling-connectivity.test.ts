import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: safeFetchMock }));
import { testProviderConnectivity } from "@/services/ai/connectivity-test";
import { testKling } from "@/services/ai/connectivity-test-connection-probes";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unmocked global fetch"))
  );
  safeFetchMock.mockReset();
  safeFetchMock.mockRejectedValue(new Error("Unexpected network request"));
});
afterEach(() => vi.unstubAllGlobals());

describe("Kling read-only authentication probe", () => {
  it.each([undefined, "kling-v1"])(
    "routes saved/custom Kling config with model %s",
    async (modelId) => {
      safeFetchMock.mockResolvedValue(Response.json({ code: 0, data: [] }));
      const result = await testProviderConnectivity({
        category: "VIDEO",
        slug: "custom-kling",
        apiProtocol: "kling",
        apiKey: "api-key",
        baseUrl: "https://proxy.example/v1/",
        extraConfig: null,
        modelId,
        enableCustomProviderFallback: true,
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain("未验证模型生成权限");
      expect(safeFetchMock).toHaveBeenCalledOnce();
      expect(safeFetchMock).toHaveBeenCalledWith(
        "https://proxy.example/v1/videos/image2video?pageNum=1&pageSize=1",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ Authorization: "Bearer api-key" }),
        })
      );
    }
  );

  it("uses legacy slug routing and the same credential precedence as generation", async () => {
    safeFetchMock.mockResolvedValue(Response.json({ code: 0, data: [] }));
    expect(
      (
        await testProviderConnectivity({
          category: "VIDEO",
          slug: "kling",
          apiKey: "primary",
          baseUrl: null,
          modelId: "kling-v1",
          extraConfig: { accessKey: "legacy", secretKey: "secret" },
        })
      ).success
    ).toBe(true);
    const authorization = safeFetchMock.mock.calls[0][1].headers
      .Authorization as string;
    expect(
      JSON.parse(
        Buffer.from(authorization.split(".")[1], "base64url").toString()
      ).iss
    ).toBe("primary");
  });

  it.each([401, 403])(
    "normalizes HTTP %s without reflecting credentials",
    async (status) => {
      safeFetchMock.mockResolvedValue(
        new Response("secret upstream content", { status })
      );
      const result = await testKling("api-key", "");
      expect(result.errorType).toBe("auth");
      expect(result.message).not.toContain("secret");
    }
  );

  it.each([
    null,
    {},
    { code: 0, data: {} },
    { code: 0 },
    { code: 1002, message: "api-key secret" },
  ])("rejects malformed/error responses %#", async (body) => {
    safeFetchMock.mockResolvedValue(Response.json(body));
    const result = await testKling("api-key", "");
    expect(result.success).toBe(false);
    expect(result.message).not.toContain("api-key");
  });

  it("rejects missing credentials before any request", async () => {
    expect((await testKling(" ", "")).errorType).toBe("config");
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("returns network errors without upstream content", async () => {
    safeFetchMock.mockRejectedValue(new Error("secret transport details"));
    const result = await testKling("api-key", "");
    expect(result.errorType).toBe("network");
    expect(result.message).not.toContain("secret");
  });
});
