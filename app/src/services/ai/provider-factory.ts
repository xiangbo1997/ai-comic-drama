/**
 * Provider Factory
 * 根据 protocol 字段路由到对应 Provider，不再依赖 baseUrl 猜测
 */

import type { LLMProvider, ImageProvider, VideoProvider, TTSProvider, ImageProviderCapability } from "./types";

// LLM providers
import { openaiCompatibleLLM } from "./providers/openai-compatible";
import { claudeLLM } from "./providers/claude";
import { geminiLLM } from "./providers/gemini";

// Image providers
import { openaiCompatibleImage } from "./providers/openai-compatible";
import { grokImage } from "./providers/grok";
import { siliconflowImage } from "./providers/siliconflow";
import { falImage } from "./providers/fal";
import { replicateImage } from "./providers/replicate";
import { proxyUnifiedImage } from "./providers/proxy-unified";

// Video providers
import { runwayVideo } from "./providers/runway";
import { falVideo } from "./providers/fal";
import { proxyUnifiedVideo } from "./providers/proxy-unified";

// TTS providers
import { volcengineTTS } from "./providers/tts/volcengine";
import { elevenlabsTTS } from "./providers/tts/elevenlabs";
import { openaiCompatibleTTS } from "./providers/tts/openai-compatible";

/** 图像 Provider 能力表 */
const IMAGE_PROVIDER_CAPABILITIES: Record<string, ImageProviderCapability> = {
  replicate: { supportsReferenceImage: true, supportsMultipleReferences: false, supportsFaceId: false, supportsInpainting: false, maxReferenceImages: 1 },
  fal: { supportsReferenceImage: true, supportsMultipleReferences: false, supportsFaceId: false, supportsInpainting: false, maxReferenceImages: 1 },
  grok: { supportsReferenceImage: false, supportsMultipleReferences: false, supportsFaceId: false, supportsInpainting: false, maxReferenceImages: 0 },
  siliconflow: { supportsReferenceImage: false, supportsMultipleReferences: false, supportsFaceId: false, supportsInpainting: false, maxReferenceImages: 0 },
  openai: { supportsReferenceImage: false, supportsMultipleReferences: false, supportsFaceId: false, supportsInpainting: false, maxReferenceImages: 0 },
  "proxy-unified": { supportsReferenceImage: true, supportsMultipleReferences: false, supportsFaceId: false, supportsInpainting: false, maxReferenceImages: 1 },
};

const DEFAULT_CAPABILITY: ImageProviderCapability = {
  supportsReferenceImage: false,
  supportsMultipleReferences: false,
  supportsFaceId: false,
  supportsInpainting: false,
  maxReferenceImages: 0,
};

/** 获取图像 Provider 能力 */
export function getImageProviderCapability(protocol: string): ImageProviderCapability {
  return IMAGE_PROVIDER_CAPABILITIES[protocol] ?? DEFAULT_CAPABILITY;
}

/** 获取 LLM Provider */
export function getLLMProvider(protocol: string): LLMProvider {
  switch (protocol) {
    case "claude":
      return claudeLLM;
    case "gemini":
      return geminiLLM;
    default:
      // openai, grok, deepseek 等 OpenAI 兼容协议
      return openaiCompatibleLLM;
  }
}

/** 获取图像生成 Provider */
export function getImageProvider(protocol: string, baseUrl?: string): ImageProvider {
  switch (protocol) {
    case "proxy-unified":
      return proxyUnifiedImage;
    case "grok":
      return grokImage;
    case "siliconflow":
      return siliconflowImage;
    case "fal":
      return falImage;
    case "replicate":
      return replicateImage;
    case "openai":
      return openaiCompatibleImage;
    default:
      break;
  }

  // 无明确协议时，根据 baseUrl 推断（兼容旧配置）
  if (baseUrl) {
    if (baseUrl.includes("x.ai")) return grokImage;
    if (baseUrl.includes("siliconflow")) return siliconflowImage;
    if (baseUrl.includes("fal.run") || baseUrl.includes("fal.ai")) return falImage;
    if (baseUrl.includes("replicate") || !baseUrl) return replicateImage;
  }

  // 最终 fallback
  return openaiCompatibleImage;
}

/** 获取视频生成 Provider */
export function getVideoProvider(protocol: string, baseUrl?: string): VideoProvider {
  switch (protocol) {
    case "runway":
      return runwayVideo;
    case "fal":
      return falVideo;
    case "proxy-unified":
    case "openai":
      return proxyUnifiedVideo;
    default:
      break;
  }

  // 兼容旧配置
  if (baseUrl) {
    if (baseUrl.includes("runwayml")) return runwayVideo;
    if (baseUrl.includes("fal.run") || baseUrl.includes("fal.ai")) return falVideo;
  }

  return runwayVideo;
}

/** 获取 TTS Provider */
export function getTTSProvider(protocol: string, baseUrl?: string): TTSProvider {
  switch (protocol) {
    case "volcengine":
      return volcengineTTS;
    case "elevenlabs":
      return elevenlabsTTS;
    case "openai":
      return openaiCompatibleTTS;
    default:
      break;
  }

  // 兼容旧配置
  if (baseUrl) {
    if (baseUrl.includes("bytedance") || baseUrl.includes("volcengine")) return volcengineTTS;
    if (baseUrl.includes("elevenlabs")) return elevenlabsTTS;
  }

  return volcengineTTS;
}
