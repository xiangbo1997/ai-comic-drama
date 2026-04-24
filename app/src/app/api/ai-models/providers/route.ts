import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:providers");

// GET /api/ai-models/providers - 获取所有可用的 AI 提供商（按分类分组）
// 包含系统预置提供商和当前用户的自定义提供商
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    // 查询系统预置提供商 + 当前用户的自定义提供商
    const providers = await prisma.aIProvider.findMany({
      where: {
        isActive: true,
        OR: [
          { isCustom: false }, // 系统预置
          { isCustom: true, userId: userId || undefined }, // 用户自定义
        ],
      },
      orderBy: [{ category: "asc" }, { isCustom: "asc" }, { sortOrder: "asc" }],
    });

    // 按分类分组
    const grouped = {
      LLM: providers.filter((p) => p.category === "LLM"),
      IMAGE: providers.filter((p) => p.category === "IMAGE"),
      VIDEO: providers.filter((p) => p.category === "VIDEO"),
      TTS: providers.filter((p) => p.category === "TTS"),
    };

    return NextResponse.json({ categories: grouped });
  } catch (error) {
    log.error("Get providers error:", error);
    return NextResponse.json({ error: "获取提供商列表失败" }, { status: 500 });
  }
}

// POST /api/ai-models/providers - 创建自定义提供商
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, category, description, baseUrl, apiProtocol, models } = body;

    if (!name || !category) {
      return NextResponse.json(
        { error: "名称和分类是必填项" },
        { status: 400 }
      );
    }

    // 验证分类
    const validCategories = ["LLM", "IMAGE", "VIDEO", "TTS"];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: "无效的分类" }, { status: 400 });
    }

    // 生成唯一 slug（用户ID + 时间戳）
    const slug = `custom-${session.user.id.slice(-6)}-${Date.now()}`;

    const provider = await prisma.aIProvider.create({
      data: {
        name,
        slug,
        category,
        description: description || null,
        baseUrl: baseUrl || null,
        apiProtocol: apiProtocol || "openai",
        models: models || [],
        isCustom: true,
        userId: session.user.id,
        sortOrder: 999, // 自定义提供商排在最后
      },
    });

    return NextResponse.json({
      id: provider.id,
      slug: provider.slug,
      success: true,
    });
  } catch (error) {
    log.error("Create custom provider error:", error);
    return NextResponse.json(
      { error: "创建自定义提供商失败" },
      { status: 500 }
    );
  }
}
