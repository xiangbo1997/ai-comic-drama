import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertSafeUrl, safeFetch } from "@/lib/url-guard";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:models");

// POST /api/ai-models/models - 动态获取提供商的模型列表
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { providerId, apiKey, customBaseUrl } = body;

    if (!providerId) {
      return NextResponse.json(
        { error: "providerId 是必填项" },
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

    // 如果没有提供 apiKey，尝试从用户已保存的配置中获取
    let effectiveApiKey = apiKey;
    // untrustedBaseUrl 标记 baseUrl 是否来自用户输入（body.customBaseUrl 或
    // 已落库的 UserAIConfig.customBaseUrl）。只有 provider.baseUrl 是可信来源，
    // 其余都必须在出站前经 assertSafeUrl 做 DNS 解析级校验。
    let effectiveBaseUrl = customBaseUrl || provider.baseUrl;
    let untrustedBaseUrl = Boolean(customBaseUrl);

    if (!effectiveApiKey) {
      const userConfig = await prisma.userAIConfig.findFirst({
        where: {
          userId: session.user.id,
          providerId,
        },
      });

      if (userConfig) {
        const { decrypt } = await import("@/lib/encryption");
        effectiveApiKey = decrypt(userConfig.apiKey, userConfig.apiKeyIv);
        if (!customBaseUrl && userConfig.customBaseUrl) {
          effectiveBaseUrl = userConfig.customBaseUrl;
          untrustedBaseUrl = true;
        }
      }
    }

    // 如果仍然没有 apiKey，返回预置模型列表
    if (!effectiveApiKey) {
      return NextResponse.json({
        models: provider.models as Array<{ id: string; name: string }>,
        source: "preset",
      });
    }

    // SSRF 防护：用户可控的 baseUrl 出站前做 DNS 解析级校验（挡内网/云元数据）。
    // 校验失败直接 400，不降级到预置列表——避免把探测行为静默吞掉。
    if (untrustedBaseUrl && effectiveBaseUrl) {
      try {
        await assertSafeUrl(effectiveBaseUrl);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Base URL 不合法" },
          { status: 400 }
        );
      }
    }

    // 尝试动态获取模型列表
    try {
      const models = await fetchModelsFromProvider(
        provider.slug,
        effectiveApiKey,
        effectiveBaseUrl,
        provider.apiProtocol
      );

      if (models && models.length > 0) {
        return NextResponse.json({
          models,
          source: "remote",
        });
      }
    } catch (error) {
      log.error("Failed to fetch models from provider:", error);
    }

    // 降级返回预置模型列表
    return NextResponse.json({
      models: provider.models as Array<{ id: string; name: string }>,
      source: "preset",
    });
  } catch (error) {
    log.error("Get models error:", error);
    return NextResponse.json({ error: "获取模型列表失败" }, { status: 500 });
  }
}

// 从各提供商获取模型列表
async function fetchModelsFromProvider(
  slug: string,
  apiKey: string,
  baseUrl: string | null,
  apiProtocol?: string | null
): Promise<Array<{ id: string; name: string }> | null> {
  // 自定义提供商：根据 apiProtocol 决定如何获取模型
  if (slug.startsWith("custom-") || apiProtocol) {
    const protocol = apiProtocol || "openai";
    switch (protocol) {
      case "openai":
      case "mistral":
      case "cohere":
        return fetchOpenAICompatibleModels(apiKey, baseUrl || "");
      case "gemini":
        return fetchGeminiModels(apiKey, baseUrl);
      case "claude":
        // Claude API 没有模型列表接口
        return null;
      case "azure-openai":
        // Azure OpenAI 需要特殊处理
        return null;
      case "flow2api": {
        // flow2api 的 OpenAI 格式模型列表在 /v1/models；
        // baseUrl 推荐不带 /v1（与 chat 端点拼接约定一致），这里补上并去重
        const root = (baseUrl || "").replace(/\/+$/, "").replace(/\/v1$/i, "");
        return root ? fetchOpenAICompatibleModels(apiKey, `${root}/v1`) : null;
      }
      default:
        return fetchOpenAICompatibleModels(apiKey, baseUrl || "");
    }
  }

  // 预置提供商
  switch (slug) {
    case "deepseek":
      return fetchOpenAICompatibleModels(
        apiKey,
        baseUrl || "https://api.deepseek.com/v1"
      );
    case "openai":
    case "openai-tts":
      return fetchOpenAICompatibleModels(
        apiKey,
        baseUrl || "https://api.openai.com/v1"
      );
    case "silicon-flow":
      return fetchOpenAICompatibleModels(
        apiKey,
        baseUrl || "https://api.siliconflow.cn/v1"
      );
    case "gemini":
      return fetchGeminiModels(apiKey, baseUrl);
    case "replicate":
      return null; // Replicate 模型太多，使用预置列表
    case "fal":
      return null; // Fal.ai 使用预置列表
    case "elevenlabs":
      return fetchElevenLabsModels(apiKey);
    default:
      // 尝试使用 OpenAI 兼容接口
      if (baseUrl) {
        return fetchOpenAICompatibleModels(apiKey, baseUrl);
      }
      return null;
  }
}

// OpenAI 兼容接口获取模型列表
async function fetchOpenAICompatibleModels(
  apiKey: string,
  baseUrl: string
): Promise<Array<{ id: string; name: string }> | null> {
  try {
    // safeFetch：钉已校验 IP + 禁跟随重定向（防 TOCTOU / 302 转内网）
    const response = await safeFetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const models = data.data || data.models || [];

    return models
      .map((m: { id: string; name?: string }) => ({
        id: m.id,
        name: m.name || m.id,
      }))
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
  } catch {
    return null;
  }
}

// Gemini 获取模型列表
async function fetchGeminiModels(
  apiKey: string,
  baseUrl: string | null
): Promise<Array<{ id: string; name: string }> | null> {
  try {
    const url = baseUrl
      ? `${baseUrl}/models?key=${apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    // safeFetch：apiKey 在 query string 上，更不能被 302 带去内网/第三方
    const response = await safeFetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const models = data.models || [];

    return models
      .filter((m: { name: string }) => m.name.includes("gemini"))
      .map((m: { name: string; displayName?: string }) => ({
        id: m.name.replace("models/", ""),
        name: m.displayName || m.name.replace("models/", ""),
      }));
  } catch {
    return null;
  }
}

// ElevenLabs 获取模型列表
async function fetchElevenLabsModels(
  apiKey: string
): Promise<Array<{ id: string; name: string }> | null> {
  try {
    const response = await safeFetch("https://api.elevenlabs.io/v1/models", {
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) return null;

    const models = await response.json();

    return models.map((m: { model_id: string; name: string }) => ({
      id: m.model_id,
      name: m.name,
    }));
  } catch {
    return null;
  }
}
