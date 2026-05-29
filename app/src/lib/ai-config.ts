/**
 * AI 配置获取工具
 * 从用户配置中获取 AI 服务的 API Key 和 Base URL
 */

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import type { AIServiceConfig } from "@/types";

export type { AIServiceConfig };

/**
 * P5：从一条 UserAIConfig(含 provider)装配为 AIServiceConfig。
 *
 * 这是四个 getUserXConfig 函数末尾完全重复的"解密 + 组装"逻辑的抽取。
 * 仅抽取真正同构的部分；各 category 的查询差异(configId/orderBy/默认 model）
 * 仍保留在各自函数中，避免"伪重复合并"引入行为变化。
 *
 * @param config 已 include provider 的配置行
 * @param fallbackModel 无 selectedModel 时的回退模型(LLM 用 provider 默认，其余用 "")
 * @param defaultProtocol 无任何 protocol 时的兜底(LLM 用 "openai"，其余用 "")
 */
function assembleServiceConfig(
  config: {
    apiKey: string;
    apiKeyIv: string;
    customBaseUrl: string | null;
    apiProtocol: string | null;
    selectedModel: string | null;
    authType: string | null;
    provider: { baseUrl: string | null; apiProtocol: string | null };
  },
  fallbackModel = "",
  defaultProtocol = ""
): AIServiceConfig {
  return {
    apiKey: decrypt(config.apiKey, config.apiKeyIv),
    baseUrl: config.customBaseUrl || config.provider.baseUrl || "",
    model: config.selectedModel || fallbackModel,
    protocol:
      config.apiProtocol || config.provider.apiProtocol || defaultProtocol,
    authType:
      (config.authType as "API_KEY" | "CHATGPT_TOKEN" | "OAUTH") || "API_KEY",
  };
}

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

  return assembleServiceConfig(
    effectiveConfig,
    getDefaultModelForProvider(effectiveConfig.provider.slug),
    "openai"
  );
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

  return assembleServiceConfig(effectiveConfig, "", "openai");
}

/**
 * 获取用户默认的视频生成配置
 */
export async function getUserVideoConfig(
  userId: string,
  configId?: string
): Promise<AIServiceConfig | null> {
  // C4：传入 configId 时优先取指定配置（多模型并行生成据此用不同 provider）
  const selectedConfig = configId
    ? await prisma.userAIConfig.findFirst({
        where: {
          id: configId,
          userId,
          isEnabled: true,
          provider: { category: "VIDEO", isActive: true },
        },
        include: { provider: true },
      })
    : null;

  const config =
    selectedConfig ||
    (await prisma.userAIConfig.findFirst({
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
    }));

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

  return assembleServiceConfig(effectiveConfig);
}

/**
 * 获取用户默认的 TTS 配置
 */
export async function getUserTTSConfig(
  userId: string,
  configId?: string
): Promise<AIServiceConfig | null> {
  // C4：传入 configId 时优先取指定配置（多音色并行生成据此用不同 provider）
  const selectedConfig = configId
    ? await prisma.userAIConfig.findFirst({
        where: {
          id: configId,
          userId,
          isEnabled: true,
          provider: { category: "TTS", isActive: true },
        },
        include: { provider: true },
      })
    : null;

  const config =
    selectedConfig ||
    (await prisma.userAIConfig.findFirst({
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
    }));

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

  return assembleServiceConfig(effectiveConfig);
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
