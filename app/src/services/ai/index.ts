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

/**
 * Hotfix2 (2026-05-21)：给单次 LLM 调用加超时
 * Hotfix3 (2026-05-21)：45s → 120s
 *
 * 背景：上游 LLM 中转站（proxy.cloudsentryai.com）偶发卡住 60-120 秒，
 * 而 Cloudflare 对 origin 的边缘超时是 100 秒 → 用户连接被切断 524。
 * Hotfix2B 异步化后总耗时不再受 CF 100s 约束，但 45s 单次超时仍偏激进 ——
 * 剧本解析在 8K maxTokens 下输出 5K+ tokens 实测常态需要 60-90s。
 *
 * 策略：用 Promise.race 在 facade 层包一层超时，让 provider 调用快速
 * fail（不取消底层 fetch，只让 await 提前 reject），上层重试机制（如
 * ScriptParserAgent 的 3 轮自修复）因此能进入下一轮。
 *
 * 默认 120 秒：覆盖 LLM 中转站慢路径 + 输出 8K tokens 的 P99 边界。
 *   - 短任务（chat 1K maxTokens）正常 5-20 秒，120s 完全留余量
 *   - 长任务（script parse 8K maxTokens）正常 30-90 秒，120s 是合理上限
 * 调用方可显式覆盖 timeoutMs（如评审/分类等轻任务用更短）。
 */
const DEFAULT_LLM_TIMEOUT_MS = 120_000;

/**
 * 视频生成默认超时（5 分钟）。
 *
 * 视频生成为同步阻塞调用，正常耗时数十秒到数分钟；超过此上限基本是上游
 * API 卡死。超时后抛错 → API 路由 catch 标记任务 FAILED（且未扣费），
 * 避免请求无限挂起。调用方可通过 options.timeoutMs 覆盖。
 */
const DEFAULT_VIDEO_TIMEOUT_MS = 300_000;

/**
 * 图像生成默认超时（3 分钟）。
 *
 * 此前 generateImage 是四类生成里唯一没有 withTimeout 的：某图像上游 TCP
 * 挂起不返回时，后台 run() 会一直 pending 占着 DB 连接 + 并发额度，直到
 * 15min 僵尸回收（且回收仅在有人轮询时触发，关页面则永不触发→连接泄漏）。
 * 与 chat/video/tts 对齐加超时上限；orchestrator 内含重试，单次 3 分钟足够。
 */
const DEFAULT_IMAGE_TIMEOUT_MS = 180_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  reason = "LLM call timeout"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${reason} (${timeoutMs}ms)`));
    }, timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function chatCompletion(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<string> {
  const {
    temperature = 0.7,
    maxTokens = 4096,
    config,
    timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
  } = options;
  const resolvedModel = options.model || config?.model;

  // Stage 2.9：用 Langfuse 包裹调用；未配置时退化为直接调用
  return observeLLM(
    {
      name: "chat_completion",
      model: resolvedModel,
      input: messages,
      metadata: {
        temperature,
        maxTokens,
        protocol: config?.protocol ?? "env",
        timeoutMs,
      },
      tags: ["llm"],
    },
    async () => {
      // 内层 provider 调用 Promise（不强制取消底层 fetch，只让 await 提前 reject）
      const providerCall = (async () => {
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
      })();

      return withTimeout(providerCall, timeoutMs, "LLM chatCompletion timeout");
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
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error(
      "未配置图像生成服务。请前往「设置 > AI 模型配置 > 图像生成」配置 Provider 并将其设为默认；或在服务端环境变量中设置 REPLICATE_API_TOKEN。"
    );
  }

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

  // 无 config（如平台兜底未命中），用 env Replicate 兜底，避免整个生图接口 500。
  if (!config) {
    return true;
  }

  // 仅当 config 是"空壳"（无有效 apiKey）时才 fallback——这通常是平台兜底场景。
  // 关键修正：若用户配了真实 apiKey 但调用失败，不再静默 fallback 到平台
  // Replicate。否则用户永远感知不到自己的 key/通道配置错误，还可能让平台
  // 账号代付费用。有真实 key 的失败应原样抛出，让用户在「测试连接」中发现。
  if (!config.apiKey || !config.apiKey.trim()) {
    return true;
  }

  return false;
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
    async () =>
      // 加超时包裹：卡死的上游不再钉住后台任务直到僵尸回收
      withTimeout(
        _generateImageInner(options),
        options.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS,
        "image generation timeout"
      ),
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS;

  // Stage 2.10：Langfuse trace
  return observeLLM(
    {
      name: "generate_video",
      model: config?.model,
      input: { imageUrl, duration, prompt },
      metadata: { protocol: config?.protocol ?? "env", timeoutMs },
      tags: ["video"],
    },
    async () => {
      // 用 withTimeout 包裹 provider 调用，防止上游 API 卡死导致请求无限挂起
      const providerCall = (async () => {
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
      })();

      return withTimeout(providerCall, timeoutMs, "视频生成超时");
    },
    (url) => ({ output: url })
  );
}

// ============ TTS 服务 ============

// TTS 超时上限：火山引擎/ElevenLabs 偶发卡住会让 workflow 永不结束（无超时则
// generate_audios 阶段挂死）。90s 足够覆盖长文本合成。
const DEFAULT_TTS_TIMEOUT_MS = 90_000;

export async function synthesizeSpeech(options: TTSOptions): Promise<Buffer> {
  const { config } = options;

  if (config) {
    const protocol = config.protocol || "volcengine";
    const provider = getTTSProvider(protocol, config.baseUrl);
    return withTimeout(
      provider.synthesizeSpeech(options, config),
      DEFAULT_TTS_TIMEOUT_MS,
      "语音合成超时"
    );
  }

  // 回退到环境变量：火山引擎
  const provider = getTTSProvider("volcengine");
  return withTimeout(
    provider.synthesizeSpeech(options, {
      apiKey: "",
      baseUrl: "",
      model: "",
      protocol: "volcengine",
    }),
    DEFAULT_TTS_TIMEOUT_MS,
    "语音合成超时"
  );
}

// ============ 成本计算 ============

export const COSTS = {
  llm: 0.00001,
  image: 0.03,
  imageWithRef: 0.03,
  video5s: 0.25,
  video10s: 0.5,
  video15s: 0.75,
  tts: 0.002,
};

export function estimateCost(params: {
  tokens?: number;
  images?: number;
  imagesWithRef?: number;
  video5s?: number;
  video10s?: number;
  video15s?: number;
  ttsChars?: number;
}): { usd: number; cny: number } {
  const usd =
    (params.images || 0) * COSTS.image +
    (params.imagesWithRef || 0) * COSTS.imageWithRef +
    (params.video5s || 0) * COSTS.video5s +
    (params.video10s || 0) * COSTS.video10s +
    (params.video15s || 0) * COSTS.video15s;

  const cny =
    (params.tokens || 0) * COSTS.llm + (params.ttsChars || 0) * COSTS.tts;

  return { usd, cny };
}
