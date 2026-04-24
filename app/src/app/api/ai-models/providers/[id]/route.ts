import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:providers:[id]");

// GET /api/ai-models/providers/[id] - 获取单个提供商详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const provider = await prisma.aIProvider.findUnique({
      where: { id },
    });

    if (!provider) {
      return NextResponse.json({ error: "提供商不存在" }, { status: 404 });
    }

    return NextResponse.json(provider);
  } catch (error) {
    log.error("Get provider error:", error);
    return NextResponse.json({ error: "获取提供商失败" }, { status: 500 });
  }
}

// PUT /api/ai-models/providers/[id] - 更新自定义提供商
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
    const { name, description, baseUrl, apiProtocol, models } = body;

    // 检查提供商是否存在且属于当前用户
    const existingProvider = await prisma.aIProvider.findFirst({
      where: {
        id,
        isCustom: true,
        userId: session.user.id,
      },
    });

    if (!existingProvider) {
      return NextResponse.json(
        { error: "提供商不存在或无权修改" },
        { status: 404 }
      );
    }

    // 准备更新数据
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      updateData.name = name;
    }
    if (description !== undefined) {
      updateData.description = description || null;
    }
    if (baseUrl !== undefined) {
      updateData.baseUrl = baseUrl || null;
    }
    if (apiProtocol !== undefined) {
      updateData.apiProtocol = apiProtocol || null;
    }
    if (models !== undefined) {
      updateData.models = models || [];
    }

    const provider = await prisma.aIProvider.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ id: provider.id, success: true });
  } catch (error) {
    log.error("Update provider error:", error);
    return NextResponse.json({ error: "更新提供商失败" }, { status: 500 });
  }
}

// DELETE /api/ai-models/providers/[id] - 删除自定义提供商
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

    // 检查提供商是否存在且属于当前用户
    const provider = await prisma.aIProvider.findFirst({
      where: {
        id,
        isCustom: true,
        userId: session.user.id,
      },
    });

    if (!provider) {
      return NextResponse.json(
        { error: "提供商不存在或无权删除" },
        { status: 404 }
      );
    }

    // 删除提供商（关联的 UserAIConfig 会级联删除）
    await prisma.aIProvider.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete provider error:", error);
    return NextResponse.json({ error: "删除提供商失败" }, { status: 500 });
  }
}
