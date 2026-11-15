import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTTSProvider } from "@/services/ai/provider-factory";
import { testProviderConnectivity } from "@/services/ai/connectivity-test";
import {
  getPrimaryProtocolsForCategory,
  generateUrlPreview,
} from "@/app/(dashboard)/settings/ai-models/components/types";
import type { AIServiceConfig } from "@/types";

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: safeFetchMock }));
const config: AIServiceConfig = {
  protocol: "grok",
  apiKey: "test-only-key",
  baseUrl: "https://grok2api.example/v1/",
  model: "grok-voice-latest",
};
beforeEach(() => {
  safeFetchMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected raw network request"))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Grok TTS 协议", () => {
  it("兼容通用二进制Content-Type的有效MP3", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(new Uint8Array([73, 68, 51, 1]), {
        headers: { "Content-Type": "application/octet-stream" },
      })
    );
    await expect(
      getTTSProvider("grok").synthesizeSpeech({ text: "Hi" }, config)
    ).resolves.toEqual(Buffer.from([73, 68, 51, 1]));
  });
  it("语音设置可直接选择Grok并预览tts端点", () => {
    const protocol = getPrimaryProtocolsForCategory("TTS").find(
      (p) => p.id === "grok"
    );
    expect(protocol).toBeDefined();
    expect(generateUrlPreview(config.baseUrl, protocol!, "TTS")).toBe(
      "https://grok2api.example/v1/tts"
    );
  });
  it("使用text、voice_id和mp3输出，透传取消信号且不走聊天或OpenAI语音端点", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(new Uint8Array([73, 68, 51, 1]), {
        headers: { "Content-Type": "audio/mpeg" },
      })
    );
    const signal = new AbortController().signal;
    const audio = await getTTSProvider("grok").synthesizeSpeech(
      { text: "你好，世界", voiceId: "eve", speed: 1.2 },
      config,
      { signal }
    );
    expect(audio).toEqual(Buffer.from([73, 68, 51, 1]));
    expect(safeFetchMock).toHaveBeenCalledOnce();
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe("https://grok2api.example/v1/tts");
    expect(JSON.parse(init.body)).toEqual({
      model: "grok-voice-latest",
      text: "你好，世界",
      voice_id: "eve",
      language: "zh",
      output_format: { codec: "mp3" },
    });
    expect(init.signal).toBe(signal);
    expect(init.headers.Authorization).toBe("Bearer test-only-key");
  });
  it.each([undefined, "default", "zh_female_shuangkuaisisi_moon_bigtts"])(
    "历史默认声线%s映射到eve",
    async (voiceId) => {
      safeFetchMock.mockResolvedValue(
        new Response(new Uint8Array([73, 68, 51]), {
          headers: { "Content-Type": "audio/mpeg" },
        })
      );
      await getTTSProvider("grok").synthesizeSpeech(
        { text: "Hello", voiceId },
        config
      );
      expect(JSON.parse(safeFetchMock.mock.calls[0][1].body).voice_id).toBe(
        "eve"
      );
    }
  );
  it("拒绝200的JSON错误响应，避免保存为mp3", async () => {
    safeFetchMock.mockResolvedValue(
      Response.json({ error: { message: "upstream failed" } })
    );
    await expect(
      getTTSProvider("grok").synthesizeSpeech({ text: "Hi" }, config)
    ).rejects.toThrow(/音频/);
  });
  it("502网页只返回安全错误并且不重提", async () => {
    safeFetchMock.mockResolvedValue(
      new Response("<!DOCTYPE html> secret gateway body", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      })
    );
    const error = await getTTSProvider("grok")
      .synthesizeSpeech({ text: "Hi" }, config)
      .catch((e) => e);
    expect(error.message).toContain("502");
    expect(error.message).not.toContain("secret");
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });
});

describe("语音模型测试不调用聊天或付费合成", () => {
  it.each(["grok", "openai"])(
    "%s仅检查模型登记并说明测试范围",
    async (protocol) => {
      safeFetchMock.mockResolvedValue(
        Response.json({ data: [{ id: "grok-voice-latest" }] })
      );
      const result = await testProviderConnectivity({
        category: "TTS",
        slug: "custom-grok",
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        modelId: config.model,
        extraConfig: null,
        apiProtocol: protocol,
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain("未执行");
      expect(safeFetchMock).toHaveBeenCalledOnce();
      expect(safeFetchMock.mock.calls[0][0]).toBe(
        "https://grok2api.example/v1/models"
      );
      expect(safeFetchMock.mock.calls[0][1].method || "GET").toBe("GET");
    }
  );
  it("列表未登记模型时提示核对ID，不偷偷按聊天调用或合成", async () => {
    safeFetchMock.mockResolvedValue(
      Response.json({ data: [{ id: "grok-voice-think-fast-1.0" }] })
    );
    const result = await testProviderConnectivity({
      category: "TTS",
      slug: "custom-grok",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      modelId: config.model,
      extraConfig: null,
      apiProtocol: "grok",
    });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("model");
    expect(result.message).toContain("未登记");
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });
});
