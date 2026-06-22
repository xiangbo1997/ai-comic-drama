/**
 * AI 配置获取工具
 * 从用户配置中获取 AI 服务的 API Key 和 Base URL
 */

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import type { AIServiceConfig } from "@/types";

export type { AIServiceConfig };

/**
 * 平台兜底配置账号 ID。
 *
 * 背景（转化漏斗修复）：新用户注册后未配置任何 AI provider key 时，
 * 第一步「文本→分镜」直接 400 死路，注册赠送的积分根本花不出去。
 * 解决：指定一个「平台兜底账号」（普通 User），平台管理员在
 * /settings/ai-models 里像配自己的模型一样为它配好 key（完全复用现有
 * UserAIConfig 体系，不写死任何供应商）。用户自己没配时，自动 fallback
 * 到这个账号的配置。env 留空则禁用兜底（行为同旧版）。
 *
 * ⚠️ 成本护栏：用平台兜底 key 的调用会消耗平台真金白银，必须配合
 * 消费上限 / 限流（见 lib/rate-limit + 后续护栏）。
 */
const PLATFORM_FALLBACK_USER_ID =
  process.env.PLATFORM_FALLBACK_USER_ID?.trim() || null;

/**
 * 判断给定 userId 是否正在使用平台兜底配置（即用户自己没配、回落到了平台账号）。
 * 供调用方做成本计量 / 限额。
 */
export function isUsingPlatformFallback(
  userId: string,
  resolvedFromUserId: string | null
): boolean {
  return (
    !!PLATFORM_FALLBACK_USER_ID &&
    resolvedFromUserId === PLATFORM_FALLBACK_USER_ID &&
    userId !== PLATFORM_FALLBACK_USER_ID
  );
}

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
  // 单次查询拿到"默认优先、否则最早创建"的 LLM 配置：orderBy isDefault desc
  // 让 isDefault=true 排最前，无默认时退到最早 enabled 配置。合并了原先
  // "先查 isDefault 再查任意 enabled"的两次串行 findFirst（每个生成请求省一次
  // DB 往返）。
  const effectiveConfig = await prisma.userAIConfig.findFirst({
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
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  // 用户自己没配 LLM → 回落到平台兜底账号（若已配置）
  const finalConfig =
    effectiveConfig ||
    (PLATFORM_FALLBACK_USER_ID && userId !== PLATFORM_FALLBACK_USER_ID
      ? await prisma.userAIConfig.findFirst({
          where: {
            userId: PLATFORM_FALLBACK_USER_ID,
            isEnabled: true,
            provider: { category: "LLM", isActive: true },
          },
          include: { provider: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        })
      : null);

  if (!finalConfig) {
    return null;
  }

  return assembleServiceConfig(
    finalConfig,
    getDefaultModelForProvider(finalConfig.provider.slug),
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

  // 合并"默认优先、否则最早创建"为单次查询（orderBy isDefault desc）
  const effectiveConfig =
    selectedConfig ||
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
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }));

  // 用户自己没配 IMAGE → 回落到平台兜底账号（若已配置）
  const finalConfig =
    effectiveConfig ||
    (PLATFORM_FALLBACK_USER_ID && userId !== PLATFORM_FALLBACK_USER_ID
      ? await prisma.userAIConfig.findFirst({
          where: {
            userId: PLATFORM_FALLBACK_USER_ID,
            isEnabled: true,
            provider: { category: "IMAGE", isActive: true },
          },
          include: { provider: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        })
      : null);

  if (!finalConfig) {
    return null;
  }

  return assembleServiceConfig(finalConfig, "", "openai");
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

  // 合并"默认优先、否则最早创建"为单次查询（orderBy isDefault desc）
  const effectiveConfig =
    selectedConfig ||
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
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }));

  // 用户自己没配 VIDEO → 回落到平台兜底账号（若已配置）
  const finalConfig =
    effectiveConfig ||
    (PLATFORM_FALLBACK_USER_ID && userId !== PLATFORM_FALLBACK_USER_ID
      ? await prisma.userAIConfig.findFirst({
          where: {
            userId: PLATFORM_FALLBACK_USER_ID,
            isEnabled: true,
            provider: { category: "VIDEO", isActive: true },
          },
          include: { provider: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        })
      : null);

  if (!finalConfig) {
    return null;
  }

  return assembleServiceConfig(finalConfig);
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

  // 合并"默认优先、否则最早创建"为单次查询（orderBy isDefault desc）
  const effectiveConfig =
    selectedConfig ||
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
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }));

  // 用户自己没配 TTS → 回落到平台兜底账号（若已配置）
  const finalConfig =
    effectiveConfig ||
    (PLATFORM_FALLBACK_USER_ID && userId !== PLATFORM_FALLBACK_USER_ID
      ? await prisma.userAIConfig.findFirst({
          where: {
            userId: PLATFORM_FALLBACK_USER_ID,
            isEnabled: true,
            provider: { category: "TTS", isActive: true },
          },
          include: { provider: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        })
      : null);

  if (!finalConfig) {
    return null;
  }

  return assembleServiceConfig(finalConfig);
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
