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
  it("fal 路由到 falVideo", () => {
    expect(getVideoProvider("fal")).toBe(falVideo);
  });

  // 未知协议不再静默兜底 runway（曾导致配好可灵实际打到 Runway 401），改为显式报错
  it("未知协议抛出显式配置错误，不再静默兜底", () => {
    expect(() => getVideoProvider("unknown")).toThrow("未知的视频生成协议");
  });

  it("未接入的服务商（kling/minimax/luma）抛出明确未接入错误", () => {
    expect(() => getVideoProvider("kling")).toThrow("暂未接入");
    expect(() => getVideoProvider("minimax")).toThrow("暂未接入");
    expect(() => getVideoProvider("luma")).toThrow("暂未接入");
  });
});

describe("getTTSProvider", () => {
  it("按 protocol 路由", () => {
    expect(getTTSProvider("volcengine")).toBe(volcengineTTS);
    expect(getTTSProvider("elevenlabs")).toBe(elevenlabsTTS);
  });

  // 未知协议不再静默兜底火山：显式暴露配置错误
  it("未知协议抛出显式配置错误，不再静默兜底", () => {
    expect(() => getTTSProvider("unknown")).toThrow("未知的语音合成协议");
  });

  it("未接入的服务商（fish-audio）抛出明确未接入错误", () => {
    expect(() => getTTSProvider("fish-audio")).toThrow("暂未接入");
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
