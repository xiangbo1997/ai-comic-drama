/**
 * AI Provider 接口定义
 */

import type {
  AIServiceConfig,
  LLMMessage,
  LLMOptions,
  ImageGenerationOptions,
  VideoGenerationOptions,
  TTSOptions,
} from "@/types";

/**
 * Provider 请求级选项：承载跨全部 provider 的传输层控制参数。
 *
 * 目前只有 signal —— 由门面 `withTimeout` 持有的 AbortSignal，逐层透传到
 * 各 provider 的 fetch 与轮询循环。超时时真正断开底层连接，而非仅让外层
 * await 提前 reject（后者会留下悬挂 socket 继续占用上游资源）。
 * 可选：未传时 provider 行为与加签名前完全一致。
 */
export interface ProviderRequestOptions {
  signal?: AbortSignal;
}

/** LLM Provider 接口 */
export interface LLMProvider {
  chatCompletion(
    messages: LLMMessage[],
    config: AIServiceConfig,
    options: {
      temperature: number;
      maxTokens: number;
      model?: string;
      signal?: AbortSignal;
    }
  ): Promise<string>;
}

/** 图像生成 Provider 接口 */
export interface ImageProvider {
  generateImage(
    options: ImageGenerationOptions,
    config: AIServiceConfig,
    requestOptions?: ProviderRequestOptions
  ): Promise<string>;
}

/** 视频生成 Provider 接口 */
export interface VideoProvider {
  generateVideo(
    options: VideoGenerationOptions,
    config: AIServiceConfig,
    requestOptions?: ProviderRequestOptions
  ): Promise<string>;
}

/** TTS Provider 接口 */
export interface TTSProvider {
  synthesizeSpeech(
    options: TTSOptions,
    config: AIServiceConfig,
    requestOptions?: ProviderRequestOptions
  ): Promise<Buffer>;
}

/** 图像 Provider 能力声明 */
export interface ImageProviderCapability {
  supportsReferenceImage: boolean;
  supportsMultipleReferences: boolean;
  supportsFaceId: boolean;
  supportsInpainting: boolean;
  maxReferenceImages: number;
}

export type {
  AIServiceConfig,
  LLMMessage,
  LLMOptions,
  ImageGenerationOptions,
  VideoGenerationOptions,
  TTSOptions,
};
