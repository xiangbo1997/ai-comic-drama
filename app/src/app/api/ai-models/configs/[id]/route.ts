import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt, maskApiKey } from "@/lib/encryption";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:configs:[id]");

// GET /api/ai-models/configs/[id] - 获取单个配置详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const config = await prisma.userAIConfig.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        provider: true,
      },
    });

    if (!config) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    return NextResponse.json({
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
      apiKeyMasked: config.apiKey ? maskApiKey(decrypt(config.apiKey, config.apiKeyIv)) : null,
      extraConfig: config.extraConfig,
    });
  } catch (error) {
    log.error("Get config error:", error);
    return NextResponse.json(
      { error: "获取配置失败" },
      { status: 500 }
    );
  }
}

// PUT /api/ai-models/configs/[id] - 更新配置
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { apiKey, extraConfig, selectedModel, isEnabled, isDefault, customBaseUrl, apiProtocol, customModels, authType, tokenExpiresAt } = body;

    // 检查配置是否存在且属于当前用户
    const existingConfig = await prisma.userAIConfig.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        provider: true,
      },
    });

    if (!existingConfig) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    // 准备更新数据
    const updateData: Record<string, unknown> = {};

    if (apiKey !== undefined) {
      const { encrypted, iv } = encrypt(apiKey);
      updateData.apiKey = encrypted;
      updateData.apiKeyIv = iv;
      updateData.testStatus = null;
      updateData.lastTestedAt = null;
    }

    if (extraConfig !== undefined) {
      updateData.extraConfig = extraConfig;
    }

    if (selectedModel !== undefined) {
      updateData.selectedModel = selectedModel;
    }

    if (isEnabled !== undefined) {
      updateData.isEnabled = isEnabled;
    }

    if (isDefault !== undefined) {
      // 如果设置为默认，先取消该分类下其他配置的默认状态
      if (isDefault) {
        await prisma.userAIConfig.updateMany({
          where: {
            userId: session.user.id,
            provider: { category: existingConfig.provider.category },
            isDefault: true,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      updateData.isDefault = isDefault;
    }

    if (customBaseUrl !== undefined) {
      updateData.customBaseUrl = customBaseUrl || null;
    }

    if (apiProtocol !== undefined) {
      updateData.apiProtocol = apiProtocol || null;
    }

    if (customModels !== undefined) {
      updateData.customModels = customModels || null;
    }

    if (authType !== undefined) {
      updateData.authType = authType;
    }

    if (tokenExpiresAt !== undefined) {
      updateData.tokenExpiresAt = tokenExpiresAt ? new Date(tokenExpiresAt) : null;
    }

    const config = await prisma.userAIConfig.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ id: config.id, success: true });
  } catch (error) {
    log.error("Update config error:", error);
    return NextResponse.json(
      { error: "更新配置失败" },
      { status: 500 }
    );
  }
}

// DELETE /api/ai-models/configs/[id] - 删除配置
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // 检查配置是否存在且属于当前用户
    const config = await prisma.userAIConfig.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!config) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    await prisma.userAIConfig.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete config error:", error);
    return NextResponse.json(
      { error: "删除配置失败" },
      { status: 500 }
    );
  }
}
