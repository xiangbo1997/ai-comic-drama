import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, maskApiKey } from "@/lib/encryption";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:configs");

// GET /api/ai-models/configs - 获取用户的所有 AI 配置
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const configs = await prisma.userAIConfig.findMany({
      where: { userId: session.user.id },
      include: {
        provider: true,
      },
      orderBy: [
        { provider: { category: "asc" } },
        { provider: { sortOrder: "asc" } },
      ],
    });

    // 返回配置（不包含真实 API Key，只返回掩码）
    const safeConfigs = configs.map((config) => ({
      id: config.id,
      providerId: config.providerId,
      provider: config.provider,
      selectedModel: config.selectedModel,
      customBaseUrl: config.customBaseUrl,
      apiProtocol: config.apiProtocol,
      customModels: config.customModels,
      isEnabled: config.isEnabled,
      isDefault: config.isDefault,
      authType: config.authType,
      tokenExpiresAt: config.tokenExpiresAt,
      testStatus: config.testStatus,
      lastTestedAt: config.lastTestedAt,
      hasApiKey: !!config.apiKey,
      apiKeyMasked: config.apiKey
        ? maskApiKey(config.apiKey.slice(0, 20))
        : null,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }));

    return NextResponse.json({ configs: safeConfigs });
  } catch (error) {
    log.error("Get configs error:", error);
    return NextResponse.json({ error: "获取配置列表失败" }, { status: 500 });
  }
}

// POST /api/ai-models/configs - 创建新的 AI 配置
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
      extraConfig,
      selectedModel,
      isDefault,
      customBaseUrl,
      apiProtocol,
      customModels,
      authType,
      tokenExpiresAt,
    } = body;

    if (!providerId) {
      return NextResponse.json(
        { error: "providerId 是必填项" },
        { status: 400 }
      );
    }

    // ChatGPT Token 认证需要 token（存在 apiKey 字段）和代理地址
    const effectiveAuthType = authType || "API_KEY";
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            effectiveAuthType === "CHATGPT_TOKEN"
              ? "请输入 Access Token"
              : "请输入 API Key",
        },
        { status: 400 }
      );
    }

    // 检查提供商是否存在
    const provider = await prisma.aIProvider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      return NextResponse.json({ error: "提供商不存在" }, { status: 400 });
    }

    // 加密 API Key
    const { encrypted, iv } = encrypt(apiKey);

    // 如果设置为默认，先取消该分类下其他配置的默认状态
    if (isDefault) {
      await prisma.userAIConfig.updateMany({
        where: {
          userId: session.user.id,
          provider: { category: provider.category },
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    // 创建或更新配置
    const config = await prisma.userAIConfig.upsert({
      where: {
        userId_providerId: {
          userId: session.user.id,
          providerId,
        },
      },
      update: {
        apiKey: encrypted,
        apiKeyIv: iv,
        customBaseUrl: customBaseUrl || null,
        apiProtocol: apiProtocol || null,
        customModels: customModels || null,
        extraConfig: extraConfig || undefined,
        selectedModel: selectedModel || undefined,
        isDefault: isDefault || false,
        authType: effectiveAuthType,
        tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
        testStatus: null,
        lastTestedAt: null,
      },
      create: {
        userId: session.user.id,
        providerId,
        apiKey: encrypted,
        apiKeyIv: iv,
        customBaseUrl: customBaseUrl || null,
        apiProtocol: apiProtocol || null,
        customModels: customModels || null,
        extraConfig: extraConfig || undefined,
        selectedModel: selectedModel || undefined,
        isDefault: isDefault || false,
        authType: effectiveAuthType,
        tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
      },
    });

    return NextResponse.json({ id: config.id, success: true });
  } catch (error) {
    log.error("Create config error:", error);
    return NextResponse.json({ error: "创建配置失败" }, { status: 500 });
  }
}
