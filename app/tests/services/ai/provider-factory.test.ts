import { describe, it, expect } from "vitest";
import {
  getLLMProvider,
  getImageProvider,
  getVideoProvider,
  getTTSProvider,
  getImageProviderCapability,
} from "@/services/ai/provider-factory";
import { openaiCompatibleLLM } from "@/services/ai/providers/openai-compatible";
import { claudeLLM } from "@/services/ai/providers/claude";
import { geminiLLM } from "@/services/ai/providers/gemini";
import { falImage } from "@/services/ai/providers/fal";
import { replicateImage } from "@/services/ai/providers/replicate";
import { siliconflowImage } from "@/services/ai/providers/siliconflow";
import { openaiCompatibleImage } from "@/services/ai/providers/openai-compatible";
import { falVideo } from "@/services/ai/providers/fal";
import { runwayVideo } from "@/services/ai/providers/runway";
import { volcengineTTS } from "@/services/ai/providers/tts/volcengine";
import { elevenlabsTTS } from "@/services/ai/providers/tts/elevenlabs";

describe("getLLMProvider", () => {
  it("claude / gemini 路由到对应 provider", () => {
    expect(getLLMProvider("claude")).toBe(claudeLLM);
    expect(getLLMProvider("gemini")).toBe(geminiLLM);
  });

  it("openai/grok/deepseek 等回落到 OpenAI 兼容", () => {
    expect(getLLMProvider("openai")).toBe(openaiCompatibleLLM);
    expect(getLLMProvider("grok")).toBe(openaiCompatibleLLM);
    expect(getLLMProvider("deepseek")).toBe(openaiCompatibleLLM);
    expect(getLLMProvider("unknown")).toBe(openaiCompatibleLLM);
  });
});

describe("getImageProvider", () => {
  it("按 protocol 精确路由", () => {
    expect(getImageProvider("fal")).toBe(falImage);
    expect(getImageProvider("replicate")).toBe(replicateImage);
    expect(getImageProvider("siliconflow")).toBe(siliconflowImage);
    expect(getImageProvider("openai")).toBe(openaiCompatibleImage);
  });

  it("无 protocol 时按 baseUrl 推断（旧兼容路径）", () => {
    expect(getImageProvider("", "https://api.siliconflow.cn/v1")).toBe(
      siliconflowImage
    );
    expect(getImageProvider("", "https://fal.run/x")).toBe(falImage);
  });

  it("无任何线索时 fallback 到 OpenAI 兼容", () => {
    expect(getImageProvider("totally-unknown")).toBe(openaiCompatibleImage);
  });
});

describe("getVideoProvider", () => {
  it("fal 路由到 falVideo，未知协议 fallback 到 runway", () => {
    expect(getVideoProvider("fal")).toBe(falVideo);
    expect(getVideoProvider("unknown")).toBe(runwayVideo);
  });
});

describe("getTTSProvider", () => {
  it("按 protocol 路由，未知 fallback 到火山引擎", () => {
    expect(getTTSProvider("volcengine")).toBe(volcengineTTS);
    expect(getTTSProvider("elevenlabs")).toBe(elevenlabsTTS);
    expect(getTTSProvider("unknown")).toBe(volcengineTTS);
  });
});

describe("getImageProviderCapability", () => {
  it("replicate 支持参考图", () => {
    expect(getImageProviderCapability("replicate").supportsReferenceImage).toBe(
      true
    );
  });

  it("未知 protocol 返回默认能力（不抛错）", () => {
    const cap = getImageProviderCapability("nope");
    expect(cap).toBeDefined();
    expect(typeof cap.supportsReferenceImage).toBe("boolean");
  });
});
