/**
 * Provider Factory
 * 根据 protocol 字段路由到对应 Provider，不再依赖 baseUrl 猜测
 */

import type {
  LLMProvider,
  ImageProvider,
  VideoProvider,
  TTSProvider,
  ImageProviderCapability,
} from "./types";

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
import { flow2apiImage } from "./providers/flow2api-image";

// Video providers
import { runwayVideo } from "./providers/runway";
import { falVideo } from "./providers/fal";
import { proxyUnifiedVideo } from "./providers/proxy-unified";
import { flow2apiVideo } from "./providers/flow2api-video";

// TTS providers
import { volcengineTTS } from "./providers/tts/volcengine";
import { elevenlabsTTS } from "./providers/tts/elevenlabs";
import { openaiCompatibleTTS } from "./providers/tts/openai-compatible";
import { gptSovitsTTS } from "./providers/tts/gpt-sovits";

/** 图像 Provider 能力表 */
const IMAGE_PROVIDER_CAPABILITIES: Record<string, ImageProviderCapability> = {
  replicate: {
    supportsReferenceImage: true,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 1,
  },
  fal: {
    supportsReferenceImage: true,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 1,
  },
  grok: {
    supportsReferenceImage: false,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 0,
  },
  siliconflow: {
    supportsReferenceImage: false,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 0,
  },
  openai: {
    supportsReferenceImage: true,
    supportsMultipleReferences: true,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 4,
  },
  "proxy-unified": {
    supportsReferenceImage: true,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 1,
  },
  // flow2api（Imagen/Gemini Image）：图生图走 image_url parts，
  // 上游协议当前最多接受 3 张参考图
  flow2api: {
    supportsReferenceImage: true,
    supportsMultipleReferences: true,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 3,
  },
};

const DEFAULT_CAPABILITY: ImageProviderCapability = {
  supportsReferenceImage: false,
  supportsMultipleReferences: false,
  supportsFaceId: false,
  supportsInpainting: false,
  maxReferenceImages: 0,
};

/** 获取图像 Provider 能力 */
export function getImageProviderCapability(
  protocol: string
): ImageProviderCapability {
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
export function getImageProvider(
  protocol: string,
  baseUrl?: string
): ImageProvider {
  switch (protocol) {
    case "proxy-unified":
      return proxyUnifiedImage;
    case "flow2api":
      return flow2apiImage;
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
    if (baseUrl.includes("fal.run") || baseUrl.includes("fal.ai"))
      return falImage;
    if (baseUrl.includes("replicate") || !baseUrl) return replicateImage;
  }

  // 最终 fallback
  return openaiCompatibleImage;
}

/**
 * 未接入的视频服务商 protocol → 中文提示。
 * 这些协议此前落到 default 分支静默返回 runwayVideo，用户配好可灵 AK/SK
 * 却被打到 Runway 报 401，误以为是密钥问题。改为显式抛错定位到「未接入」。
 */
const UNIMPLEMENTED_VIDEO_PROTOCOLS: Record<string, string> = {
  kling: "可灵",
  minimax: "MiniMax",
  luma: "Luma",
};

/** 获取视频生成 Provider */
export function getVideoProvider(
  protocol: string,
  baseUrl?: string
): VideoProvider {
  switch (protocol) {
    case "runway":
      return runwayVideo;
    case "fal":
      return falVideo;
    case "flow2api":
      return flow2apiVideo;
    case "proxy-unified":
    case "openai":
      return proxyUnifiedVideo;
    default:
      break;
  }

  // 已知但未接入的服务商：显式报错，别静默兜底到 Runway 造成误导
  const unimplemented = UNIMPLEMENTED_VIDEO_PROTOCOLS[protocol];
  if (unimplemented) {
    throw new Error(
      `该服务商（${unimplemented}）暂未接入，请在 AI 模型设置选择其他服务商`
    );
  }

  // 兼容旧配置：仅对未显式声明 protocol 的历史配置按 baseUrl 推断
  if (baseUrl) {
    if (baseUrl.includes("runwayml")) return runwayVideo;
    if (baseUrl.includes("fal.run") || baseUrl.includes("fal.ai"))
      return falVideo;
  }

  // 未知协议不再静默兜底：显式暴露配置错误
  throw new Error(
    `未知的视频生成协议「${protocol}」，请在 AI 模型设置检查配置`
  );
}

/** 获取 TTS Provider */
export function getTTSProvider(
  protocol: string,
  baseUrl?: string
): TTSProvider {
  switch (protocol) {
    case "volcengine":
      return volcengineTTS;
    case "elevenlabs":
      return elevenlabsTTS;
    case "openai":
      return openaiCompatibleTTS;
    case "gpt-sovits":
      return gptSovitsTTS;
    // Fish Audio 已在 seed 预置但 provider 未接入：此前落到默认兜底
    // volcengineTTS，配好 Fish Audio Key 却打到火山导致鉴权失败误报。
    case "fish-audio":
      throw new Error(
        "该服务商（Fish Audio）暂未接入，请在 AI 模型设置选择其他服务商"
      );
    default:
      break;
  }

  // 兼容旧配置：仅对未显式声明 protocol 的历史配置按 baseUrl 推断
  if (baseUrl) {
    if (baseUrl.includes("bytedance") || baseUrl.includes("volcengine"))
      return volcengineTTS;
    if (baseUrl.includes("elevenlabs")) return elevenlabsTTS;
  }

  // 未知协议不再静默兜底到火山：显式暴露配置错误
  throw new Error(
    `未知的语音合成协议「${protocol}」，请在 AI 模型设置检查配置`
  );
}
