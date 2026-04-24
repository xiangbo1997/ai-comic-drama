import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isLLMModel } from "@/services/ai/providers/openai-compatible";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:test");

// 测试结果详情类型
interface TestResultDetail {
  success: boolean;
  message: string;
  errorCode?: string;
  errorType?: "auth" | "network" | "model" | "config" | "unknown";
  suggestion?: string;
}

type ProviderCategory = "LLM" | "IMAGE" | "VIDEO" | "TTS";

const IMAGE_RUNTIME_PROTOCOLS = new Set([
  "openai",
  "grok",
  "siliconflow",
  "fal",
  "replicate",
  "proxy-unified",
]);

const IMAGE_TEST_PROMPT =
  "test image, a simple blue circle on white background";

// POST /api/ai-models/test - 测试 API 连接（无需先保存配置）
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      providerId,
      apiKey,
      customBaseUrl,
      extraConfig,
      modelId,
      apiProtocol,
    } = body;

    if (!providerId || !apiKey) {
      return NextResponse.json(
        { error: "providerId 和 apiKey 是必填项" },
        { status: 400 }
      );
    }

    // 获取提供商信息
    const provider = await prisma.aIProvider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      return NextResponse.json({ error: "提供商不存在" }, { status: 404 });
    }

    const effectiveBaseUrl = customBaseUrl || provider.baseUrl;

    // 测试连接
    const startTime = Date.now();
    let testResult: TestResultDetail;

    try {
      // 如果指定了模型，则测试模型可用性；否则只测试连接
      if (modelId) {
        const effectiveProtocol = apiProtocol || provider.apiProtocol;
        testResult = await testModelAvailability(
          provider.category as ProviderCategory,
          provider.slug,
          apiKey,
          effectiveBaseUrl,
          modelId,
          extraConfig,
          effectiveProtocol
        );
      } else {
        const effectiveProtocol = apiProtocol || provider.apiProtocol;
        testResult = await testProviderConnection(
          provider.slug,
          apiKey,
          effectiveBaseUrl,
          extraConfig,
          effectiveProtocol
        );
      }
    } catch (error) {
      testResult = {
        success: false,
        message: error instanceof Error ? error.message : "测试失败",
        errorType: "unknown",
        suggestion: "请检查网络连接或稍后重试",
      };
    }

    const latency = Date.now() - startTime;

    return NextResponse.json({
      success: testResult.success,
      message: testResult.message,
      errorCode: testResult.errorCode,
      errorType: testResult.errorType,
      suggestion: testResult.suggestion,
      latency,
      testedModel: modelId,
      testedUrl: effectiveBaseUrl,
    });
  } catch (error) {
    log.error("Test connection error:", error);
    return NextResponse.json({ error: "测试连接失败" }, { status: 500 });
  }
}

// 测试特定模型的可用性
async function testModelAvailability(
  category: ProviderCategory,
  slug: string,
  apiKey: string,
  baseUrl: string | null,
  modelId: string,
  extraConfig: Record<string, string> | null,
  apiProtocol?: string | null
): Promise<TestResultDetail> {
  if (category === "IMAGE") {
    return testImageModelAvailability(
      slug,
      apiKey,
      baseUrl,
      modelId,
      apiProtocol
    );
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
): Promise<TestResultDetail> {
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

function getImageRuntimeSupportIssue(
  protocol: string
): TestResultDetail | null {
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

async function testOpenAIModelImage(
  apiKey: string,
  baseUrl: string,
  modelId: string
): Promise<TestResultDetail> {
  if (isLLMModel(modelId)) {
    return {
      success: false,
      message: `模型 ${modelId} 是文本模型，不支持图片生成`,
      errorType: "model",
      suggestion:
        "请选择真正的图片模型，例如 dall-e-3、gpt-image-1、grok-2-image 等",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        prompt: IMAGE_TEST_PROMPT,
        size: "1024x1024",
        n: 1,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.data?.[0]?.url || data?.data?.[0]?.b64_json) {
        return {
          success: true,
          message: `模型 ${modelId} 已通过真实图片接口测试`,
        };
      }

      return {
        success: false,
        message: `模型 ${modelId} 响应成功，但未返回可解析的图片结果`,
        errorType: "config",
        suggestion: "该通道可能不是标准图片接口，请检查协议或更换供应商",
      };
    }

    const errorText = await response.text();
    const loweredError = errorText.toLowerCase();

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: `图片接口认证失败: ${errorText.slice(0, 300)}`,
        errorType: "auth",
        suggestion: "请检查 API Key 权限，确认该账号具备图片生成权限",
      };
    }

    if (
      response.status === 404 ||
      loweredError.includes("model") ||
      loweredError.includes("not found")
    ) {
      return {
        success: false,
        message: `模型 ${modelId} 无法通过图片接口调用: ${errorText.slice(0, 300)}`,
        errorType: "model",
        suggestion: "请确认该模型是图片模型，且服务商支持 /images/generations",
      };
    }

    return {
      success: false,
      message: `图片接口测试失败 (${response.status}): ${errorText.slice(0, 300)}`,
      errorType: response.status >= 500 ? "network" : "unknown",
      suggestion: "请检查图片接口是否已开通，或稍后重试",
    };
  } catch (error) {
    return {
      success: false,
      message: `图片接口网络错误: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查 Base URL 是否正确，并确认该地址支持图片接口",
    };
  }
}

async function testSiliconFlowModelImage(
  apiKey: string,
  baseUrl: string,
  modelId: string
): Promise<TestResultDetail> {
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        prompt: IMAGE_TEST_PROMPT,
        image_size: "1024x1024",
        num_inference_steps: 1,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.images?.[0]?.url || data?.data?.[0]?.url) {
        return {
          success: true,
          message: `模型 ${modelId} 已通过真实图片接口测试`,
        };
      }
    }

    const errorText = await response.text();
    return {
      success: false,
      message: `图片接口测试失败 (${response.status}): ${errorText.slice(0, 300)}`,
      errorType:
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 404
            ? "model"
            : "unknown",
      suggestion: "请确认该 SiliconFlow 模型支持生图，并且账号有调用权限",
    };
  } catch (error) {
    return {
      success: false,
      message: `图片接口网络错误: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查 SiliconFlow 地址是否正确",
    };
  }
}

async function testProxyUnifiedImageModel(
  apiKey: string,
  baseUrl: string,
  modelId: string
): Promise<TestResultDetail> {
  if (isLLMModel(modelId)) {
    return {
      success: false,
      message: `模型 ${modelId} 是文本模型，不支持图片生成`,
      errorType: "model",
      suggestion: "通用中转图片模式需要返回图片 URL 的图像模型",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: IMAGE_TEST_PROMPT }],
        stream: false,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return {
        success: false,
        message: `通用中转图片测试失败 (${response.status}): ${responseText.slice(0, 300)}`,
        errorType:
          response.status === 401 || response.status === 403
            ? "auth"
            : response.status === 404
              ? "model"
              : "unknown",
        suggestion: "请确认该模型能通过统一端点返回图片结果，而不是纯文本回复",
      };
    }

    const data = JSON.parse(responseText);
    const content =
      typeof data?.choices?.[0]?.message?.content === "string"
        ? data.choices[0].message.content
        : "";
    const hasImageUrl =
      Boolean(data?.data?.[0]?.url) ||
      /!\[.*?\]\((https?:\/\/[^\s)]+)\)/.test(content) ||
      /(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|webp))/i.test(content);

    if (!hasImageUrl) {
      return {
        success: false,
        message: `模型 ${modelId} 未返回可解析的图片结果`,
        errorType: "config",
        suggestion:
          "该统一端点当前更像文本接口，不能作为项目里的图片供应商使用",
      };
    }

    return {
      success: true,
      message: `模型 ${modelId} 已通过统一端点图片结果测试`,
    };
  } catch (error) {
    return {
      success: false,
      message: `通用中转图片测试失败: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查中转站是否支持通过 /chat/completions 返回图片 URL",
    };
  }
}

async function testFalModelImage(
  apiKey: string,
  modelId: string
): Promise<TestResultDetail> {
  try {
    const response = await fetch(`https://queue.fal.run/${modelId}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: IMAGE_TEST_PROMPT,
        image_size: "square",
        num_images: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `Fal 图片测试失败 (${response.status}): ${errorText.slice(0, 300)}`,
        errorType:
          response.status === 401 || response.status === 403
            ? "auth"
            : response.status === 404
              ? "model"
              : "unknown",
        suggestion: "请确认模型名正确，并且 Fal 账号有权限调用该模型",
      };
    }

    const data = await response.json();
    if (!data?.request_id) {
      return {
        success: false,
        message: "Fal 返回成功，但未拿到 request_id",
        errorType: "config",
        suggestion: "该模型返回格式与项目运行时不匹配",
      };
    }

    return {
      success: true,
      message: `模型 ${modelId} 已通过真实图片任务提交测试`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Fal 图片测试失败: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查网络和 Fal API Key",
    };
  }
}

async function testReplicateModelImage(
  apiKey: string,
  modelId: string
): Promise<TestResultDetail> {
  if (!modelId.includes("/")) {
    return {
      success: false,
      message: `Replicate 模型 ${modelId} 格式不正确`,
      errorType: "config",
      suggestion:
        "请使用 owner/model 格式，例如 black-forest-labs/flux-schnell",
    };
  }

  try {
    const response = await fetch(
      `https://api.replicate.com/v1/models/${modelId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (response.ok) {
      return {
        success: true,
        message: `模型 ${modelId} 存在并可访问`,
      };
    }

    const errorText = await response.text();
    return {
      success: false,
      message: `Replicate 模型校验失败 (${response.status}): ${errorText.slice(0, 300)}`,
      errorType:
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 404
            ? "model"
            : "unknown",
      suggestion: "请确认模型名正确，并且账号有访问该 Replicate 模型的权限",
    };
  } catch (error) {
    return {
      success: false,
      message: `Replicate 模型校验失败: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查网络或稍后重试",
    };
  }
}

// 测试 OpenAI 兼容接口的特定模型
async function testOpenAIModelChat(
  apiKey: string,
  baseUrl: string,
  modelId: string
): Promise<TestResultDetail> {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 10,
      }),
    });

    if (response.ok) {
      return {
        success: true,
        message: `模型 ${modelId} 可用`,
      };
    }

    const errorText = await response.text();
    let errorJson: {
      error?: { message?: string; code?: string; type?: string };
    } = {};
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      // 非 JSON 响应
    }

    const errorMessage = errorJson.error?.message || errorText.slice(0, 300);
    const errorCode = errorJson.error?.code || `HTTP_${response.status}`;

    // 根据错误类型提供详细信息
    if (response.status === 401) {
      return {
        success: false,
        message: `认证失败: ${errorMessage}`,
        errorCode,
        errorType: "auth",
        suggestion: "请检查 API Key 是否正确，或是否有权限访问该服务",
      };
    }

    if (
      response.status === 404 ||
      errorMessage.toLowerCase().includes("model")
    ) {
      return {
        success: false,
        message: `模型 ${modelId} 不可用: ${errorMessage}`,
        errorCode,
        errorType: "model",
        suggestion: `该中转节点可能不支持模型 ${modelId}，请尝试其他模型或检查模型名称`,
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        message: `请求频率限制: ${errorMessage}`,
        errorCode,
        errorType: "network",
        suggestion: "请稍后重试，或检查账户配额",
      };
    }

    if (response.status >= 500) {
      return {
        success: false,
        message: `服务器错误: ${errorMessage}`,
        errorCode,
        errorType: "network",
        suggestion: "服务端暂时不可用，请稍后重试",
      };
    }

    return {
      success: false,
      message: `测试失败 (${response.status}): ${errorMessage}`,
      errorCode,
      errorType: "unknown",
      suggestion: "请检查配置是否正确",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求失败";
    return {
      success: false,
      message: `网络错误: ${message}`,
      errorType: "network",
      suggestion: "请检查网络连接，或确认中转节点地址是否正确",
    };
  }
}

// 测试 Gemini 特定模型
async function testGeminiModel(
  apiKey: string,
  baseUrl: string | null,
  modelId: string
): Promise<TestResultDetail> {
  try {
    const url = baseUrl
      ? `${baseUrl}/models/${modelId}:generateContent?key=${apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hi" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });

    if (response.ok) {
      return { success: true, message: `模型 ${modelId} 可用` };
    }

    const errorText = await response.text();
    let errorJson: {
      error?: { message?: string; code?: number; status?: string };
    } = {};
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      // 非 JSON 响应
    }

    const errorMessage = errorJson.error?.message || errorText.slice(0, 300);

    if (response.status === 400 && errorMessage.includes("not found")) {
      return {
        success: false,
        message: `模型 ${modelId} 不存在: ${errorMessage}`,
        errorType: "model",
        suggestion: "请检查模型名称是否正确",
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        message: `无权访问模型 ${modelId}: ${errorMessage}`,
        errorType: "auth",
        suggestion: "请检查 API Key 权限或账户配额",
      };
    }

    return {
      success: false,
      message: `测试失败 (${response.status}): ${errorMessage}`,
      errorType: "unknown",
    };
  } catch (error) {
    return {
      success: false,
      message: `网络错误: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查网络连接",
    };
  }
}

// 测试 Claude 特定模型
async function testClaudeModel(
  apiKey: string,
  baseUrl: string | null,
  modelId: string
): Promise<TestResultDetail> {
  try {
    const url = baseUrl
      ? `${baseUrl}/messages`
      : "https://api.anthropic.com/v1/messages";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    if (response.ok) {
      return { success: true, message: `模型 ${modelId} 可用` };
    }

    const errorText = await response.text();
    let errorJson: { error?: { message?: string; type?: string } } = {};
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      // 非 JSON 响应
    }

    const errorMessage = errorJson.error?.message || errorText.slice(0, 300);

    if (
      response.status === 400 &&
      errorMessage.toLowerCase().includes("model")
    ) {
      return {
        success: false,
        message: `模型 ${modelId} 不可用: ${errorMessage}`,
        errorType: "model",
        suggestion: "请检查模型名称是否正确",
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        message: `认证失败: ${errorMessage}`,
        errorType: "auth",
        suggestion: "请检查 API Key 是否正确",
      };
    }

    return {
      success: false,
      message: `测试失败 (${response.status}): ${errorMessage}`,
      errorType: "unknown",
    };
  } catch (error) {
    return {
      success: false,
      message: `网络错误: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查网络连接",
    };
  }
}

// 测试各提供商连接
async function testProviderConnection(
  slug: string,
  apiKey: string,
  baseUrl: string | null,
  extraConfig: Record<string, string> | null,
  apiProtocol?: string | null
): Promise<{ success: boolean; message: string }> {
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
      return { success: false, message: `不支持的提供商: ${slug}` };
  }
}

// OpenAI 兼容接口测试（DeepSeek、硅基流动等）
async function testOpenAICompatible(
  apiKey: string,
  baseUrl: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Gemini 测试
async function testGemini(
  apiKey: string,
  baseUrl: string | null
): Promise<{ success: boolean; message: string }> {
  const url = baseUrl
    ? `${baseUrl}/models?key=${apiKey}`
    : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(url);
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Claude 测试
async function testClaude(
  apiKey: string,
  baseUrl: string | null
): Promise<{ success: boolean; message: string }> {
  const url = baseUrl
    ? `${baseUrl}/messages`
    : "https://api.anthropic.com/v1/messages";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    }),
  });
  if (response.ok || response.status === 400) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Replicate 测试
async function testReplicate(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch("https://api.replicate.com/v1/account", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Fal.ai 测试
async function testFal(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch("https://queue.fal.run/fal-ai/flux/requests", {
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (response.ok || response.status === 404) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Runway 测试
async function testRunway(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch("https://api.dev.runwayml.com/v1/tasks", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": "2024-11-06",
    },
  });
  if (response.ok || response.status === 404) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Luma 测试
async function testLuma(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(
    "https://api.lumalabs.ai/dream-machine/v1/generations",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );
  if (response.ok || response.status === 404) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// 可灵测试
async function testKling(
  accessKey: string,
  secretKey: string
): Promise<{ success: boolean; message: string }> {
  if (!accessKey || !secretKey) {
    return { success: false, message: "需要 Access Key 和 Secret Key" };
  }
  return { success: true, message: "配置格式正确（需实际调用验证）" };
}

// MiniMax 测试
async function testMinimax(
  apiKey: string,
  groupId: string
): Promise<{ success: boolean; message: string }> {
  if (!groupId) {
    return { success: false, message: "需要 Group ID" };
  }
  const response = await fetch(
    `https://api.minimax.chat/v1/text/chatcompletion_v2?GroupId=${groupId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "abab6.5s-chat",
        messages: [{ role: "user", content: "Hi" }],
      }),
    }
  );
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// 火山引擎测试
async function testVolcengine(
  appId: string,
  accessToken: string
): Promise<{ success: boolean; message: string }> {
  if (!appId || !accessToken) {
    return { success: false, message: "需要 App ID 和 Access Token" };
  }
  return { success: true, message: "配置格式正确（需实际调用验证）" };
}

// Fish Audio 测试
async function testFishAudio(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch("https://api.fish.audio/model", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// ElevenLabs 测试
async function testElevenLabs(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": apiKey },
  });
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}
