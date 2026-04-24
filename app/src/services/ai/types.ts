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

/** LLM Provider 接口 */
export interface LLMProvider {
  chatCompletion(
    messages: LLMMessage[],
    config: AIServiceConfig,
    options: { temperature: number; maxTokens: number; model?: string }
  ): Promise<string>;
}

/** 图像生成 Provider 接口 */
export interface ImageProvider {
  generateImage(options: ImageGenerationOptions, config: AIServiceConfig): Promise<string>;
}

/** 视频生成 Provider 接口 */
export interface VideoProvider {
  generateVideo(options: VideoGenerationOptions, config: AIServiceConfig): Promise<string>;
}

/** TTS Provider 接口 */
export interface TTSProvider {
  synthesizeSpeech(options: TTSOptions, config: AIServiceConfig): Promise<Buffer>;
}

/** 图像 Provider 能力声明 */
export interface ImageProviderCapability {
  supportsReferenceImage: boolean;
  supportsMultipleReferences: boolean;
  supportsFaceId: boolean;
  supportsInpainting: boolean;
  maxReferenceImages: number;
}

export type { AIServiceConfig, LLMMessage, LLMOptions, ImageGenerationOptions, VideoGenerationOptions, TTSOptions };
