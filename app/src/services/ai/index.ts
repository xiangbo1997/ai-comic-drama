/**
 * AI 服务统一封装
 * 提供 LLM、图像、视频、TTS 的统一调用接口
 *
 * 公共 API 签名与旧 services/ai.ts 完全兼容，调用方无需改动
 */

import type {
  AIServiceConfig,
  LLMMessage,
  LLMOptions,
  ImageGenerationOptions,
  VideoGenerationOptions,
  TTSOptions,
} from "@/types";
import {
  getLLMProvider,
  getImageProvider,
  getVideoProvider,
  getTTSProvider,
} from "./provider-factory";
import { createLogger } from "@/lib/logger";
import { observeLLM } from "@/lib/observability/langfuse";

export type {
  LLMMessage,
  LLMOptions,
  ImageGenerationOptions,
  VideoGenerationOptions,
  TTSOptions,
};

const log = createLogger("services:ai");

// ============ LLM 服务 ============

export async function chatCompletion(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<string> {
  const { temperature = 0.7, maxTokens = 4096, config } = options;
  const resolvedModel = options.model || config?.model;

  // Stage 2.9：用 Langfuse 包裹调用；未配置时退化为直接调用
  return observeLLM(
    {
      name: "chat_completion",
      model: resolvedModel,
      input: messages,
      metadata: { temperature, maxTokens, protocol: config?.protocol ?? "env" },
      tags: ["llm"],
    },
    async () => {
      if (config) {
        const protocol = config.protocol || "openai";
        const provider = getLLMProvider(protocol);
        return provider.chatCompletion(messages, config, {
          temperature,
          maxTokens,
          model: options.model,
        });
      }

      // 回退到环境变量配置（兼容旧代码）
      const baseUrl =
        process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
      const apiKey = process.env.DEEPSEEK_API_KEY;
      const model = options.model || "deepseek-chat";

      if (!apiKey) {
        throw new Error("未配置 LLM 服务，请在 AI 模型配置页面添加配置");
      }

      const provider = getLLMProvider("openai");
      return provider.chatCompletion(
        messages,
        { apiKey, baseUrl: `${baseUrl}/v1`, model, protocol: "openai" },
        { temperature, maxTokens, model }
      );
    },
    (result) => ({
      output: result,
      usage: {
        // 粗略估算（真正的 provider-specific token 计数需要上游改造）
        totalTokens: Math.ceil(String(result).length / 4),
      },
    })
  );
}

// ============ 图像生成服务 ============

async function generateImageWithEnvReplicate(
  prompt: string,
  referenceImage?: string,
  aspectRatio: string = "9:16"
): Promise<string> {
  const { default: Replicate } = await import("replicate");
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  if (referenceImage) {
    const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
      input: {
        prompt,
        image_url: referenceImage,
        aspect_ratio: aspectRatio,
        safety_tolerance: 2,
        output_format: "webp",
      },
    });
    return output as unknown as string;
  }

  const output = await replicate.run("black-forest-labs/flux-schnell", {
    input: {
      prompt,
      aspect_ratio: aspectRatio,
      output_format: "webp",
    },
  });

  const result = output as string[];
  return result[0];
}

function shouldFallbackToEnvReplicate(config?: AIServiceConfig): boolean {
  if (!process.env.REPLICATE_API_TOKEN) {
    return false;
  }

  if (!config) {
    return true;
  }

  // 当用户自定义图像通道不可用时，回退到环境变量中的 Replicate，避免整个生图接口直接 500。
  return (
    config.protocol !== "replicate" ||
    config.apiKey !== process.env.REPLICATE_API_TOKEN
  );
}

export async function generateImage(
  options: ImageGenerationOptions
): Promise<string> {
  const { prompt, referenceImage, aspectRatio = "9:16", config } = options;

  // Stage 2.10：Langfuse 包装（image provider）
  return observeLLM(
    {
      name: "generate_image",
      model: config?.model,
      input: {
        prompt,
        hasRef: !!referenceImage || (options.referenceImages?.length ?? 0) > 0,
        aspectRatio,
      },
      metadata: {
        protocol: config?.protocol ?? "env",
        style: options.style,
        hasNegative: !!options.negativePrompt,
      },
      tags: ["image"],
    },
    async () => _generateImageInner(options),
    (url) => ({ output: url })
  );
}

async function _generateImageInner(
  options: ImageGenerationOptions
): Promise<string> {
  const { prompt, referenceImage, aspectRatio = "9:16", config } = options;

  if (config) {
    const protocol = config.protocol || "openai";
    const provider = getImageProvider(protocol, config.baseUrl);

    try {
      return await provider.generateImage(options, config);
    } catch (error) {
      if (!shouldFallbackToEnvReplicate(config)) {
        throw error;
      }

      log.warn(
        "Configured image provider failed, falling back to env Replicate",
        {
          protocol,
          model: config.model,
          baseUrl: config.baseUrl,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  // 降级：使用环境变量中的 Replicate
  return generateImageWithEnvReplicate(prompt, referenceImage, aspectRatio);
}

// ============ 视频生成服务 ============

export async function generateVideo(
  options: VideoGenerationOptions
): Promise<string> {
  const { config, imageUrl, duration, prompt } = options;

  // Stage 2.10：Langfuse trace
  return observeLLM(
    {
      name: "generate_video",
      model: config?.model,
      input: { imageUrl, duration, prompt },
      metadata: { protocol: config?.protocol ?? "env" },
      tags: ["video"],
    },
    async () => {
      if (config) {
        const protocol = config.protocol || "runway";
        const provider = getVideoProvider(protocol, config.baseUrl);
        return provider.generateVideo(options, config);
      }

      const apiKey = process.env.RUNWAY_API_KEY;
      if (!apiKey) {
        throw new Error("未配置视频生成服务，请在 AI 模型配置页面添加配置");
      }
      const provider = getVideoProvider("runway");
      return provider.generateVideo(options, {
        apiKey,
        baseUrl: "",
        model: "",
        protocol: "runway",
      });
    },
    (url) => ({ output: url })
  );
}

// ============ TTS 服务 ============

export async function synthesizeSpeech(options: TTSOptions): Promise<Buffer> {
  const { config } = options;

  if (config) {
    const protocol = config.protocol || "volcengine";
    const provider = getTTSProvider(protocol, config.baseUrl);
    return provider.synthesizeSpeech(options, config);
  }

  // 回退到环境变量：火山引擎
  const provider = getTTSProvider("volcengine");
  return provider.synthesizeSpeech(options, {
    apiKey: "",
    baseUrl: "",
    model: "",
    protocol: "volcengine",
  });
}

// ============ 成本计算 ============

export const COSTS = {
  llm: 0.00001,
  image: 0.03,
  imageWithRef: 0.03,
  video5s: 0.25,
  video10s: 0.5,
  tts: 0.002,
};

export function estimateCost(params: {
  tokens?: number;
  images?: number;
  imagesWithRef?: number;
  video5s?: number;
  video10s?: number;
  ttsChars?: number;
}): { usd: number; cny: number } {
  const usd =
    (params.images || 0) * COSTS.image +
    (params.imagesWithRef || 0) * COSTS.imageWithRef +
    (params.video5s || 0) * COSTS.video5s +
    (params.video10s || 0) * COSTS.video10s;

  const cny =
    (params.tokens || 0) * COSTS.llm + (params.ttsChars || 0) * COSTS.tts;

  return { usd, cny };
}
