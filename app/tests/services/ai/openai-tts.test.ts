import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openaiCompatibleTTS } from "@/services/ai/providers/tts/openai-compatible";
import { testProviderConnectivity } from "@/services/ai/connectivity-test";
import type { AIServiceConfig } from "@/types";
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: safeFetchMock }));
const config: AIServiceConfig = {
  apiKey: "local-test-only",
  baseUrl: "https://chatgpt2api.example/v1/",
  model: "chatgpt-tts",
  protocol: "openai",
};
beforeEach(() => {
  safeFetchMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("No raw fetch allowed"))
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("chatgpt-tts使用OpenAI语音协议", () => {
  it("缺少类型但有MP3帧头也能接收", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))
    );
    await expect(
      openaiCompatibleTTS.synthesizeSpeech({ text: "Hi" }, config)
    ).resolves.toEqual(Buffer.from([0xff, 0xfb, 0x90, 0x64]));
  });
  it("兼容通用二进制Content-Type的有效MP3", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(new Uint8Array([73, 68, 51, 1]), {
        headers: { "Content-Type": "application/octet-stream" },
      })
    );
    await expect(
      openaiCompatibleTTS.synthesizeSpeech({ text: "Hi" }, config)
    ).resolves.toEqual(Buffer.from([73, 68, 51, 1]));
  });
  it("二进制Content-Type下的JSON仍不能当作MP3", async () => {
    safeFetchMock.mockResolvedValue(
      new Response('{"error":"failed"}', {
        headers: { "Content-Type": "application/octet-stream" },
      })
    );
    await expect(
      openaiCompatibleTTS.synthesizeSpeech({ text: "Hi" }, config)
    ).rejects.toThrow(/音频/);
  });
  it.each([
    undefined,
    "default",
    "zh_female_shuangkuaisisi_moon_bigtts",
    "alloy",
  ])("声线%s使用alloy，显式请求mp3", async (voiceId) => {
    safeFetchMock.mockResolvedValue(
      new Response(new Uint8Array([73, 68, 51]), {
        headers: { "Content-Type": "audio/mpeg" },
      })
    );
    const audio = await openaiCompatibleTTS.synthesizeSpeech(
      { text: "你好，这是语音合成测试。", voiceId, speed: 1 },
      config
    );
    expect(audio).toEqual(Buffer.from([73, 68, 51]));
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe("https://chatgpt2api.example/v1/audio/speech");
    expect(JSON.parse(init.body)).toEqual({
      model: "chatgpt-tts",
      input: "你好，这是语音合成测试。",
      voice: "alloy",
      response_format: "mp3",
      speed: 1,
    });
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });
  it("保留显式音色及取消信号", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "audio/mpeg" },
      })
    );
    const signal = new AbortController().signal;
    await openaiCompatibleTTS.synthesizeSpeech(
      { text: "Hello", voiceId: "nova" },
      config,
      { signal }
    );
    expect(JSON.parse(safeFetchMock.mock.calls[0][1].body).voice).toBe("nova");
    expect(safeFetchMock.mock.calls[0][1].signal).toBe(signal);
  });
  it("模型测试只读取models，避免400不支持聊天接口", async () => {
    safeFetchMock.mockResolvedValue(
      Response.json({ data: [{ id: "chatgpt-tts" }] })
    );
    const result = await testProviderConnectivity({
      category: "TTS",
      slug: "openai-tts",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      modelId: "chatgpt-tts",
      apiProtocol: "openai",
      extraConfig: null,
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("未执行真实语音合成");
    expect(safeFetchMock.mock.calls[0][0]).toBe(
      "https://chatgpt2api.example/v1/models"
    );
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });
  it.each([
    Response.json({ error: "failure" }),
    new Response("<html>error</html>", {
      headers: { "Content-Type": "text/html" },
    }),
    new Response(null, { headers: { "Content-Type": "audio/mpeg" } }),
  ])("拒绝伪装成功或空音频 %#", async (response) => {
    safeFetchMock.mockResolvedValue(response);
    await expect(
      openaiCompatibleTTS.synthesizeSpeech({ text: "Hi" }, config)
    ).rejects.toThrow(/音频/);
  });
  it("错误不包含原始网页、密钥且不重复下单", async () => {
    safeFetchMock.mockResolvedValue(
      new Response("local-test-only upstream body", { status: 502 })
    );
    const error = await openaiCompatibleTTS
      .synthesizeSpeech({ text: "Hi" }, config)
      .catch((e) => e);
    expect(error.message).toContain("502");
    expect(error.message).not.toContain("local-test-only");
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });
});
