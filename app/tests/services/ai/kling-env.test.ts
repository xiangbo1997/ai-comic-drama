import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), factory: vi.fn() }));
vi.mock("@/services/ai/provider-factory", () => ({
  getVideoProvider: mocks.factory,
  getLLMProvider: vi.fn(),
  getImageProvider: vi.fn(),
  getTTSProvider: vi.fn(),
}));
vi.mock("@/lib/observability/langfuse", () => ({
  observeLLM: async (_input: unknown, run: () => Promise<unknown>) => run(),
}));
import { generateVideo } from "@/services/ai";
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of [
    "KLING_API_KEY",
    "KLING_ACCESS_KEY",
    "KLING_SECRET_KEY",
    "KLING_BASE_URL",
    "KLING_MODEL",
    "RUNWAY_API_KEY",
  ])
    vi.stubEnv(key, "");
  mocks.factory.mockReturnValue({ generateVideo: mocks.generate });
  mocks.generate.mockResolvedValue("https://cdn.example/video.mp4");
});
afterEach(() => vi.unstubAllEnvs());
describe("Kling environment fallback", () => {
  it("prefers the API Key when both authentication forms are configured", async () => {
    vi.stubEnv("KLING_API_KEY", " api-key ");
    vi.stubEnv("KLING_ACCESS_KEY", "access");
    vi.stubEnv("KLING_SECRET_KEY", "secret");
    await generateVideo({ imageUrl: "https://cdn.example/frame.jpg" });
    expect(mocks.factory).toHaveBeenCalledWith("kling");
    expect(mocks.generate.mock.calls[0][1]).toMatchObject({
      apiKey: "api-key",
      model: "kling-v2-6",
      baseUrl: "https://api-beijing.klingai.com",
      extraConfig: undefined,
    });
  });
  it("supports the legacy key pair and configured host/model", async () => {
    vi.stubEnv("KLING_ACCESS_KEY", "access");
    vi.stubEnv("KLING_SECRET_KEY", "secret");
    vi.stubEnv("KLING_BASE_URL", "https://proxy.example/v1");
    vi.stubEnv("KLING_MODEL", "kling-v2-5-turbo");
    await generateVideo({ imageUrl: "https://cdn.example/frame.jpg" });
    expect(mocks.generate.mock.calls[0][1]).toMatchObject({
      apiKey: "access",
      extraConfig: { secretKey: "secret" },
      model: "kling-v2-5-turbo",
      baseUrl: "https://proxy.example/v1",
    });
  });
  it("keeps explicit user configuration ahead of environment fallback", async () => {
    vi.stubEnv("KLING_API_KEY", "api-key");
    const config = {
      apiKey: "user-key",
      baseUrl: "https://runway.example",
      model: "gen3a_turbo",
      protocol: "runway" as const,
    };
    await generateVideo({ imageUrl: "https://cdn.example/frame.jpg", config });
    expect(mocks.factory).toHaveBeenCalledWith("runway", config.baseUrl);
    expect(mocks.generate.mock.calls[0][1]).toBe(config);
  });
  it("preserves the Runway fallback when Kling is not fully configured", async () => {
    vi.stubEnv("KLING_ACCESS_KEY", "access");
    vi.stubEnv("RUNWAY_API_KEY", "runway-key");
    await generateVideo({ imageUrl: "https://cdn.example/frame.jpg" });
    expect(mocks.factory).toHaveBeenCalledWith("runway");
  });
});
