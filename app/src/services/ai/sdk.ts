/**
 * Vercel AI SDK v6 封装（Stage 3.1 + 3.2）
 *
 * 目的：
 * - 把"文本 LLM 调用"的内部实现从 3 份手写 provider（openai-compatible/claude/gemini）
 *   统一为 AI SDK。消除协议适配层，能力（tool-use / structured output / streaming）天然获得。
 * - 不替换 `services/ai/index.ts#chatCompletion`：那是老入口，保留兼容性（尤其 `proxy-unified`
 *   协议，AI SDK 不原生支持，必须走自定义 provider）。
 * - 新增 `chatCompletionV2` 作为可选入口；新代码建议用它，老代码不需要改。
 *
 * 路由：
 * - protocol=openai / deepseek / siliconflow / grok / 其他 OpenAI 兼容 → @ai-sdk/openai
 * - protocol=claude → @ai-sdk/anthropic
 * - protocol=gemini → @ai-sdk/google
 * - protocol=proxy-unified → **回退到老 chatCompletion**（AI SDK 无法适配中转站自定义 schema）
 */

import { generateText, streamText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { AIServiceConfig, LLMMessage } from "@/types";
import { createLogger } from "@/lib/logger";
import { chatCompletion as legacyChatCompletion } from "./index";

const log = createLogger("services:ai:sdk");

/**
 * 从 AIServiceConfig 构造 AI SDK 的 LanguageModel。
 * 返回 null 表示该 protocol 不适合用 AI SDK（调用方应走老 chatCompletion）。
 */
function buildSDKModel(config: AIServiceConfig): LanguageModel | null {
  const protocol = (config.protocol || "openai").toLowerCase();
  const model = config.model || "gpt-4o-mini";

  switch (protocol) {
    case "claude":
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return anthropic(model);
    }
    case "gemini":
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return google(model);
    }
    case "openai":
    case "deepseek":
    case "siliconflow":
    case "grok":
    case "xai":
    case "openai-compatible": {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return openai(model);
    }
    default:
      return null; // 未知/proxy-unified → 调用方降级
  }
}

/**
 * 转换内部 LLMMessage 为 AI SDK 的 CoreMessage 格式。
 * 当前 LLMMessage.content 是 string；AI SDK 支持 string | parts array，这里直通。
 */
function toCoreMessages(messages: LLMMessage[]): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export interface ChatCompletionV2Options {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  config: AIServiceConfig;
  /** Streaming callback：每次 token 触发；不设则 buffer 全部再返回 */
  onToken?: (token: string) => void;
}

/**
 * 新版 chatCompletion：基于 Vercel AI SDK。
 * 签名与老 `chatCompletion` 兼容（都返回完整字符串），新代码可用它。
 */
export async function chatCompletionV2(
  messages: LLMMessage[],
  options: ChatCompletionV2Options
): Promise<string> {
  const { config, temperature = 0.7, maxTokens = 4096, onToken } = options;
  const modelOverride = options.model;
  const effectiveConfig = modelOverride
    ? { ...config, model: modelOverride }
    : config;

  // proxy-unified 协议无法用 AI SDK 适配（中转站的 chat-completion 响应形状不固定）
  // → 降级到老 chatCompletion，保持功能不受损
  if (effectiveConfig.protocol === "proxy-unified") {
    log.debug("Falling back to legacy chatCompletion for proxy-unified");
    return legacyChatCompletion(messages, {
      temperature,
      maxTokens,
      model: modelOverride,
      config: effectiveConfig,
    });
  }

  const model = buildSDKModel(effectiveConfig);
  if (!model) {
    log.debug(
      `Protocol "${effectiveConfig.protocol}" not supported by AI SDK, falling back`
    );
    return legacyChatCompletion(messages, {
      temperature,
      maxTokens,
      model: modelOverride,
      config: effectiveConfig,
    });
  }

  const coreMessages = toCoreMessages(messages);

  if (onToken) {
    // Streaming 模式
    const { textStream } = streamText({
      model,
      messages: coreMessages,
      temperature,
    });
    let buffered = "";
    for await (const token of textStream) {
      buffered += token;
      onToken(token);
    }
    return buffered;
  }

  // 一次性返回
  const { text } = await generateText({
    model,
    messages: coreMessages,
    temperature,
  });
  return text;
}

/**
 * 导出给上层做"结构化输出"的调用。
 * 比 chatCompletionV2 + JSON.parse 更稳：AI SDK 用 zod schema 直接校验。
 */
export async function generateStructured<T>(args: {
  messages: LLMMessage[];
  schema: unknown; // 运行时是 zod schema；类型上保持 loose 以避免 zod peer dep 冲突
  config: AIServiceConfig;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const {
    messages,
    schema,
    config,
    temperature = 0.3,
    model: modelOverride,
  } = args;
  const effectiveConfig = modelOverride
    ? { ...config, model: modelOverride }
    : config;
  const sdkModel = buildSDKModel(effectiveConfig);
  if (!sdkModel) {
    throw new Error(
      `generateStructured: protocol "${effectiveConfig.protocol}" not supported by AI SDK`
    );
  }

  // 动态导入，避免循环依赖
  const { generateObject } = await import("ai");
  const result = await generateObject({
    model: sdkModel,
    messages: toCoreMessages(messages),
    temperature,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK 对 schema 要求 zod ≥3
    schema: schema as any,
  });
  return result.object as T;
}
