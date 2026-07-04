/**
 * AI Provider 连通性测试统一门面
 *
 * 抽取自两个近乎重复的路由：
 *   - POST /api/ai-models/test（测试请求体里未保存的配置）
 *   - POST /api/ai-models/configs/[id]/test（测试已保存并解密后的配置）
 *
 * 两条路由的「协议连通性探测」核心逻辑（openai 兼容 / claude / gemini / grok /
 * replicate / fal / siliconflow / proxy-unified / flow2api 视频 SSE 探测 /
 * 各家 TTS 与视频厂商连通性、延迟测量、模型列举、错误归一化）此前各存一份，
 * 现统一收口到本模块。路由只保留：鉴权 + 参数校验 + 配置装配（body 解析 /
 * DB 解密）+ 调用门面 + 路由专属副作用（如落库 testStatus）+ HTTP 映射。
 *
 * 响应形状、状态码、SSRF 校验点、错误文案均保持与原路由一致（错误文案是
 * 用户可见的，前端 ProviderCard/ConfigDialog 直接展示 data.message）。
 *
 * 本文件只做「分发编排」；实际发起 fetch 的叶子探测在
 * connectivity-test-probes.ts，共享类型在 connectivity-test-types.ts。
 */

import { createLogger } from "@/lib/logger";
import type {
  ProviderCategory,
  ResolvedTestConfig,
  TestResult,
} from "./connectivity-test-types";
import {
  testOpenAIModelImage,
  testSiliconFlowModelImage,
  testProxyUnifiedImageModel,
  testFalModelImage,
  testReplicateModelImage,
  testOpenAIModelChat,
  testGeminiModel,
  testClaudeModel,
  testFlow2apiVideoModel,
} from "./connectivity-test-probes";
import {
  testOpenAICompatible,
  testGemini,
  testClaude,
  testReplicate,
  testFal,
  testRunway,
  testLuma,
  testKling,
  testMinimax,
  testVolcengine,
  testFishAudio,
  testElevenLabs,
} from "./connectivity-test-connection-probes";

const log = createLogger("services:ai:connectivity-test");

export type { ProviderCategory, ResolvedTestConfig, TestResult };

const IMAGE_RUNTIME_PROTOCOLS = new Set([
  "openai",
  "grok",
  "siliconflow",
  "fal",
  "replicate",
  "proxy-unified",
]);

/**
 * 连通性测试门面。
 *
 * 有 modelId → 测模型可用性；否则只测提供商连通性。任何底层异常都归一化为
 * { success:false, errorType:"unknown" }，与原路由 try/catch 语义一致。
 */
export async function testProviderConnectivity(
  config: ResolvedTestConfig
): Promise<TestResult> {
  const { modelId } = config;
  try {
    if (modelId) {
      return await testModelAvailability(config, modelId);
    }
    return await testProviderConnection(config);
  } catch (error) {
    log.error("Connectivity test error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "测试失败",
      errorType: "unknown",
      suggestion: "请检查网络连接或稍后重试",
    };
  }
}

// ============ 模型可用性测试（分发） ============

async function testModelAvailability(
  config: ResolvedTestConfig,
  modelId: string
): Promise<TestResult> {
  const { category, slug, apiKey, baseUrl, apiProtocol } = config;

  if (category === "IMAGE") {
    return testImageModelAvailability(
      slug,
      apiKey,
      baseUrl,
      modelId,
      apiProtocol
    );
  }

  // VIDEO 分类专属：flow2api 协议走 SSE 探测（仅已保存配置路由启用）
  if (
    config.enableFlow2apiVideoProbe &&
    category === "VIDEO" &&
    apiProtocol === "flow2api"
  ) {
    return testFlow2apiVideoModel(apiKey, baseUrl, modelId);
  }

  // 根据协议选择测试方法
  const testByProtocol = (protocol: string) => {
    switch (protocol) {
      case "gemini":
        return testGeminiModel(apiKey, baseUrl, modelId);
      case "claude":
        return testClaudeModel(apiKey, baseUrl, modelId);
      default:
        return testOpenAIModelChat(apiKey, baseUrl || "", modelId);
    }
  };

  // slug 对应的默认协议
  const slugDefaultProtocol: Record<string, string> = {
    claude: "claude",
    gemini: "gemini",
    deepseek: "openai",
    openai: "openai",
    "silicon-flow": "openai",
    "openai-tts": "openai",
  };

  const effectiveProtocol =
    apiProtocol || slugDefaultProtocol[slug] || "openai";
  const fallbackProtocol = slugDefaultProtocol[slug];

  // 优先使用用户选择的协议测试
  const result = await testByProtocol(effectiveProtocol);

  // 如果失败且有不同的 fallback 协议，自动重试
  if (
    !result.success &&
    fallbackProtocol &&
    fallbackProtocol !== effectiveProtocol
  ) {
    const fallbackResult = await testByProtocol(fallbackProtocol);
    if (fallbackResult.success) {
      return {
        ...fallbackResult,
        message: `${fallbackResult.message}（使用 ${fallbackProtocol} 协议，建议修改 API 协议设置）`,
      };
    }
  }

  return result;
}

async function testImageModelAvailability(
  slug: string,
  apiKey: string,
  baseUrl: string | null,
  modelId: string,
  apiProtocol?: string | null
): Promise<TestResult> {
  const effectiveProtocol = apiProtocol || slug;
  const runtimeSupportIssue = getImageRuntimeSupportIssue(effectiveProtocol);
  if (runtimeSupportIssue) {
    return runtimeSupportIssue;
  }

  switch (effectiveProtocol) {
    case "grok":
    case "openai":
      return testOpenAIModelImage(apiKey, baseUrl || "", modelId);
    case "siliconflow":
      return testSiliconFlowModelImage(
        apiKey,
        baseUrl || "https://api.siliconflow.cn/v1",
        modelId
      );
    case "proxy-unified":
      return testProxyUnifiedImageModel(apiKey, baseUrl || "", modelId);
    case "fal":
      return testFalModelImage(apiKey, modelId);
    case "replicate":
      return testReplicateModelImage(apiKey, modelId);
    default:
      return {
        success: false,
        message: `当前项目尚未接入「${effectiveProtocol}」协议的图片生成运行时`,
        errorType: "config",
        suggestion:
          "请改用 OpenAI 兼容、Grok、SiliconFlow、Fal、Replicate 或通用中转协议",
      };
  }
}

function getImageRuntimeSupportIssue(protocol: string): TestResult | null {
  if (IMAGE_RUNTIME_PROTOCOLS.has(protocol)) {
    return null;
  }

  return {
    success: false,
    message: `当前项目运行时不支持「${protocol}」协议的图片生成`,
    errorType: "config",
    suggestion:
      "请切换到 OpenAI 兼容、Grok、SiliconFlow、Fal、Replicate 或通用中转协议",
  };
}

// ============ 提供商连通性测试（无模型 ID，分发） ============

async function testProviderConnection(
  config: ResolvedTestConfig
): Promise<TestResult> {
  const { slug, apiKey, baseUrl, extraConfig, apiProtocol } = config;

  // 自定义提供商：根据 apiProtocol 决定测试方式（仅已保存配置路由启用）。
  // 未保存配置路由不启用该分支，保持其历史 switch 行为。
  if (
    config.enableCustomProviderFallback &&
    (slug.startsWith("custom-") ||
      (apiProtocol &&
        !["deepseek", "openai", "gemini", "claude"].includes(slug)))
  ) {
    const protocol = apiProtocol || "openai";
    switch (protocol) {
      case "openai":
      case "mistral":
      case "cohere":
        return testOpenAICompatible(
          apiKey,
          baseUrl || "https://api.openai.com/v1"
        );
      case "gemini":
        return testGemini(apiKey, null);
      case "claude":
        return testClaude(apiKey, null);
      default:
        return testOpenAICompatible(
          apiKey,
          baseUrl || "https://api.openai.com/v1"
        );
    }
  }

  switch (slug) {
    // LLM 提供商
    case "deepseek":
      return testOpenAICompatible(
        apiKey,
        baseUrl || "https://api.deepseek.com/v1"
      );
    case "openai":
      return testOpenAICompatible(
        apiKey,
        baseUrl || "https://api.openai.com/v1"
      );
    case "gemini":
      return testGemini(apiKey, baseUrl);
    case "claude":
      return testClaude(apiKey, baseUrl);

    // 图像提供商
    case "replicate":
      return testReplicate(apiKey);
    case "fal":
      return testFal(apiKey);
    case "silicon-flow":
      return testOpenAICompatible(
        apiKey,
        baseUrl || "https://api.siliconflow.cn/v1"
      );

    // 视频提供商
    case "runway":
      return testRunway(apiKey);
    case "luma":
      return testLuma(apiKey);
    case "kling":
      return testKling(
        extraConfig?.accessKey || apiKey,
        extraConfig?.secretKey || ""
      );
    case "minimax":
      return testMinimax(apiKey, extraConfig?.groupId || "");

    // TTS 提供商
    case "volcengine":
      return testVolcengine(
        extraConfig?.appId || "",
        extraConfig?.accessToken || apiKey
      );
    case "fish-audio":
      return testFishAudio(apiKey);
    case "elevenlabs":
      return testElevenLabs(apiKey);
    case "openai-tts":
      return testOpenAICompatible(
        apiKey,
        baseUrl || "https://api.openai.com/v1"
      );

    default:
      // 已保存配置路由：有 baseUrl 时尝试 OpenAI 兼容兜底；否则报不支持。
      if (config.enableCustomProviderFallback && baseUrl) {
        return testOpenAICompatible(apiKey, baseUrl);
      }
      return { success: false, message: `不支持的提供商: ${slug}` };
  }
}
