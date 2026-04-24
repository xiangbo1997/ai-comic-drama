/**
 * AI 配置获取工具
 * 从用户配置中获取 AI 服务的 API Key 和 Base URL
 */

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import type { AIServiceConfig } from "@/types";

export type { AIServiceConfig };

/**
 * 获取用户默认的 LLM 配置
 * @param userId 用户 ID
 * @returns LLM 配置或 null
 */
export async function getUserLLMConfig(
  userId: string
): Promise<AIServiceConfig | null> {
  // 查找用户在 LLM 分类下的默认配置
  const config = await prisma.userAIConfig.findFirst({
    where: {
      userId,
      isEnabled: true,
      provider: {
        category: "LLM",
        isActive: true,
      },
      isDefault: true,
    },
    include: {
      provider: true,
    },
  });

  // 如果没有默认配置，尝试获取任意一个已启用的 LLM 配置
  const effectiveConfig =
    config ||
    (await prisma.userAIConfig.findFirst({
      where: {
        userId,
        isEnabled: true,
        provider: {
          category: "LLM",
          isActive: true,
        },
      },
      include: {
        provider: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }));

  if (!effectiveConfig) {
    return null;
  }

  // 解密 API Key
  const apiKey = decrypt(effectiveConfig.apiKey, effectiveConfig.apiKeyIv);

  // 确定 Base URL（优先使用自定义 URL）
  const baseUrl =
    effectiveConfig.customBaseUrl || effectiveConfig.provider.baseUrl || "";

  // 确定协议（优先使用配置级别的协议，否则使用提供商默认协议）
  const protocol =
    effectiveConfig.apiProtocol ||
    effectiveConfig.provider.apiProtocol ||
    "openai";

  // 确定模型
  const model =
    effectiveConfig.selectedModel ||
    getDefaultModelForProvider(effectiveConfig.provider.slug);

  return {
    apiKey,
    baseUrl,
    model,
    protocol,
    authType:
      (effectiveConfig.authType as "API_KEY" | "CHATGPT_TOKEN" | "OAUTH") ||
      "API_KEY",
  };
}

/**
 * 获取用户默认的图像生成配置
 */
export async function getUserImageConfig(
  userId: string,
  configId?: string
): Promise<AIServiceConfig | null> {
  const selectedConfig = configId
    ? await prisma.userAIConfig.findFirst({
        where: {
          id: configId,
          userId,
          isEnabled: true,
          provider: {
            category: "IMAGE",
            isActive: true,
          },
        },
        include: {
          provider: true,
        },
      })
    : null;

  const config =
    selectedConfig ||
    (await prisma.userAIConfig.findFirst({
      where: {
        userId,
        isEnabled: true,
        provider: {
          category: "IMAGE",
          isActive: true,
        },
        isDefault: true,
      },
      include: {
        provider: true,
      },
    }));

  const effectiveConfig =
    config ||
    (await prisma.userAIConfig.findFirst({
      where: {
        userId,
        isEnabled: true,
        provider: {
          category: "IMAGE",
          isActive: true,
        },
      },
      include: {
        provider: true,
      },
    }));

  if (!effectiveConfig) {
    return null;
  }

  const apiKey = decrypt(effectiveConfig.apiKey, effectiveConfig.apiKeyIv);
  const baseUrl =
    effectiveConfig.customBaseUrl || effectiveConfig.provider.baseUrl || "";
  const protocol =
    effectiveConfig.apiProtocol ||
    effectiveConfig.provider.apiProtocol ||
    "openai";
  const model = effectiveConfig.selectedModel || "";

  return {
    apiKey,
    baseUrl,
    model,
    protocol,
    authType:
      (effectiveConfig.authType as "API_KEY" | "CHATGPT_TOKEN" | "OAUTH") ||
      "API_KEY",
  };
}

/**
 * 获取用户默认的视频生成配置
 */
export async function getUserVideoConfig(
  userId: string
): Promise<AIServiceConfig | null> {
  const config = await prisma.userAIConfig.findFirst({
    where: {
      userId,
      isEnabled: true,
      provider: {
        category: "VIDEO",
        isActive: true,
      },
      isDefault: true,
    },
    include: {
      provider: true,
    },
  });

  const effectiveConfig =
    config ||
    (await prisma.userAIConfig.findFirst({
      where: {
        userId,
        isEnabled: true,
        provider: {
          category: "VIDEO",
          isActive: true,
        },
      },
      include: {
        provider: true,
      },
    }));

  if (!effectiveConfig) {
    return null;
  }

  const apiKey = decrypt(effectiveConfig.apiKey, effectiveConfig.apiKeyIv);
  const baseUrl =
    effectiveConfig.customBaseUrl || effectiveConfig.provider.baseUrl || "";
  const protocol =
    effectiveConfig.apiProtocol || effectiveConfig.provider.apiProtocol || "";
  const model = effectiveConfig.selectedModel || "";

  return {
    apiKey,
    baseUrl,
    model,
    protocol,
    authType:
      (effectiveConfig.authType as "API_KEY" | "CHATGPT_TOKEN" | "OAUTH") ||
      "API_KEY",
  };
}

/**
 * 获取用户默认的 TTS 配置
 */
export async function getUserTTSConfig(
  userId: string
): Promise<AIServiceConfig | null> {
  const config = await prisma.userAIConfig.findFirst({
    where: {
      userId,
      isEnabled: true,
      provider: {
        category: "TTS",
        isActive: true,
      },
      isDefault: true,
    },
    include: {
      provider: true,
    },
  });

  const effectiveConfig =
    config ||
    (await prisma.userAIConfig.findFirst({
      where: {
        userId,
        isEnabled: true,
        provider: {
          category: "TTS",
          isActive: true,
        },
      },
      include: {
        provider: true,
      },
    }));

  if (!effectiveConfig) {
    return null;
  }

  const apiKey = decrypt(effectiveConfig.apiKey, effectiveConfig.apiKeyIv);
  const baseUrl =
    effectiveConfig.customBaseUrl || effectiveConfig.provider.baseUrl || "";
  const protocol =
    effectiveConfig.apiProtocol || effectiveConfig.provider.apiProtocol || "";
  const model = effectiveConfig.selectedModel || "";

  return {
    apiKey,
    baseUrl,
    model,
    protocol,
    authType:
      (effectiveConfig.authType as "API_KEY" | "CHATGPT_TOKEN" | "OAUTH") ||
      "API_KEY",
  };
}

/**
 * 根据提供商 slug 获取默认模型
 */
function getDefaultModelForProvider(slug: string): string {
  const defaultModels: Record<string, string> = {
    deepseek: "deepseek-chat",
    openai: "gpt-4o-mini",
    claude: "claude-3-5-sonnet-20241022",
    gemini: "gemini-1.5-flash",
    "silicon-flow": "deepseek-ai/DeepSeek-V3",
  };
  return defaultModels[slug] || "gpt-4o-mini";
}
