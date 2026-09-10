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
import { TimeoutAbortError, throwIfAborted } from "./abort";

export type {
  LLMMessage,
  LLMOptions,
  ImageGenerationOptions,
  VideoGenerationOptions,
  TTSOptions,
};

// 类型化错误从门面转出：调用方（如 ScriptParserAgent）统一从 @/services/ai 引入，
// 无需知道 providers 内部结构。实现在 ./errors 以避免 provider→index 循环引用。
export { TruncatedOutputError, isTruncatedOutputError } from "./errors";

// 超时中止错误同样从门面转出：调用方需要区分「超时」与「上游报错」以决定是否重试。
export { TimeoutAbortError, isTimeoutAbortError } from "./abort";

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
 * 策略：withTimeout 在 facade 层持有 AbortController，超时即 abort 底层
 * fetch（见其文档），让 provider 调用快速 fail 且不留悬挂连接，上层重试
 * 机制（如 ScriptParserAgent 的 3 轮自修复）因此能进入下一轮。
 *
 * 默认 120 秒：覆盖 LLM 中转站慢路径 + 输出 8K tokens 的 P99 边界。
 *   - 短任务（chat 1K maxTokens）正常 5-20 秒，120s 完全留余量
 *   - 长任务（script parse 8K maxTokens）正常 30-90 秒，120s 是合理上限
 * 调用方可显式覆盖 timeoutMs（如评审/分类等轻任务用更短）。
 */
const DEFAULT_LLM_TIMEOUT_MS = 120_000;

/**
 * 长文本生成超时（5 分钟）——用于一次性产出整份结构化长文的 Agent
 * （短剧脚本 / 分镜表 / 角色圣经等，maxTokens 8K 量级）。
 *
 * Hotfix4 (2026-09-10)：上游推理模型（gpt-6-astra）实测生成完整短剧脚本需
 * 131 秒、gpt-5.6 需 172 秒，均已超过 120s 默认值 → DramaScriptAgent 三轮
 * 重试全部 timeout，用户侧表现为「生成短剧脚本失败」。
 *
 * 前置条件：必须直连中转站（见 lib/url-guard.ts 的 INTERNAL_API_ALLOWLIST）。
 * 若仍走公网域名，Cloudflare 的 100 秒 origin 超时（524）会先于本超时触发，
 * 把这里调大不会有任何效果。
 */
export const LONG_FORM_LLM_TIMEOUT_MS = 300_000;

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

/**
 * 超时包裹：**真正中止**底层请求，而不只是让 await 提前 reject。
 *
 * 旧实现（Promise.race 语义）只 reject 外层 Promise，底层 fetch 的 socket
 * 仍挂在上游直到 TCP 层自己超时：并发额度被提前释放但连接还活着，卡死的
 * 上游会持续占用连接池/内存，且请求真的被上游处理完后还会白白扣一次配额。
 *
 * 现在 withTimeout 持有 AbortController：
 * 1. 把 signal 传给 fn，由各 provider 透传到 fetch / 轮询循环；
 * 2. 超时触发 abort → 底层连接立即断开；
 * 3. 无论成功/失败/超时都 clearTimeout，不留悬挂定时器。
 *
 * 中止后 fetch 抛的是 AbortError（信息量为零），这里统一翻译回既有的
 * `${reason} (${timeoutMs}ms)` 文案，保持对上层与用户可见的错误语义不变。
 * 注意：只有「本次超时」触发的 abort 才翻译；调用方传入的外部 signal 触发
 * 的中止不属于超时，原样冒泡。
 */
function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  reason = "LLM call timeout"
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return (async () => {
    try {
      return await fn(controller.signal);
    } catch (error) {
      if (timedOut) {
        throw new TimeoutAbortError(`${reason} (${timeoutMs}ms)`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })();
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
    async () =>
      // signal 由 withTimeout 持有并下传到 provider 的 fetch：超时即断连，
      // 不再留悬挂 socket 占用上游资源
      withTimeout(
        async (signal) => {
          if (config) {
            const protocol = config.protocol || "openai";
            const provider = getLLMProvider(protocol);
            return provider.chatCompletion(messages, config, {
              temperature,
              maxTokens,
              model: options.model,
              signal,
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
            { temperature, maxTokens, model, signal }
          );
        },
        timeoutMs,
        "LLM chatCompletion timeout"
      ),
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
      // 加超时包裹：卡死的上游不再钉住后台任务直到僵尸回收；
      // signal 下传到 provider，超时即断连而非仅 reject
      withTimeout(
        (signal) => _generateImageInner(options, signal),
        options.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS,
        "image generation timeout"
      ),
    (url) => ({ output: url })
  );
}

async function _generateImageInner(
  options: ImageGenerationOptions,
  signal?: AbortSignal
): Promise<string> {
  const { prompt, referenceImage, aspectRatio = "9:16", config } = options;

  if (config) {
    const protocol = config.protocol || "openai";
    const provider = getImageProvider(protocol, config.baseUrl);

    try {
      return await provider.generateImage(options, config, { signal });
    } catch (error) {
      if (!shouldFallbackToEnvReplicate(config)) {
        throw error;
      }

      // 已被中止（超时/上层取消）时不再兜底：兜底调用会在已耗尽的时间预算外
      // 重新发起一次生成，既拖长失败反馈又白烧一次 Replicate 配额。
      throwIfAborted(signal);

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
    async () =>
      // 用 withTimeout 包裹 provider 调用，防止上游 API 卡死导致请求无限挂起；
      // signal 下传后超时会真正断开提交连接并终止轮询循环
      withTimeout(
        async (signal) => {
          if (config) {
            const protocol = config.protocol || "runway";
            const provider = getVideoProvider(protocol, config.baseUrl);
            return provider.generateVideo(options, config, { signal });
          }

          const apiKey = process.env.RUNWAY_API_KEY;
          if (!apiKey) {
            throw new Error("未配置视频生成服务，请在 AI 模型配置页面添加配置");
          }
          const provider = getVideoProvider("runway");
          return provider.generateVideo(
            options,
            {
              apiKey,
              baseUrl: "",
              model: "",
              protocol: "runway",
            },
            { signal }
          );
        },
        timeoutMs,
        "视频生成超时"
      ),
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
      (signal) => provider.synthesizeSpeech(options, config, { signal }),
      DEFAULT_TTS_TIMEOUT_MS,
      "语音合成超时"
    );
  }

  // 回退到环境变量：火山引擎
  const provider = getTTSProvider("volcengine");
  return withTimeout(
    (signal) =>
      provider.synthesizeSpeech(
        options,
        {
          apiKey: "",
          baseUrl: "",
          model: "",
          protocol: "volcengine",
        },
        { signal }
      ),
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
