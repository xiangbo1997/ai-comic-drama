import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:preferences");

// GET /api/ai-models/preferences - 获取用户生成偏好
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let preference = await prisma.userGenerationPreference.findUnique({
      where: { userId: session.user.id },
    });

    // 如果不存在，创建默认偏好
    if (!preference) {
      preference = await prisma.userGenerationPreference.create({
        data: {
          userId: session.user.id,
          concurrencyMode: "PARALLEL",
          maxConcurrent: 3,
        },
      });
    }

    return NextResponse.json({ preference });
  } catch (error) {
    log.error("Get preferences error:", error);
    return NextResponse.json({ error: "获取偏好设置失败" }, { status: 500 });
  }
}

// PUT /api/ai-models/preferences - 更新用户生成偏好
export async function PUT(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    // 废弃字段 defaultLLM/defaultImage/defaultVideo/defaultTTS 不再接收：
    // 无 UI、生成侧零消费（默认走 UserAIConfig.isDefault），此前透传只写死数据。
    // schema 列暂保留（不动 schema），但路由停止读写，避免死字段被误当作有效配置。
    const { concurrencyMode, maxConcurrent } = body;

    // 验证并发模式
    if (concurrencyMode && !["SERIAL", "PARALLEL"].includes(concurrencyMode)) {
      return NextResponse.json({ error: "无效的并发模式" }, { status: 400 });
    }

    // 验证最大并发数
    if (
      maxConcurrent !== undefined &&
      (maxConcurrent < 1 || maxConcurrent > 10)
    ) {
      return NextResponse.json(
        { error: "最大并发数必须在 1-10 之间" },
        { status: 400 }
      );
    }

    const preference = await prisma.userGenerationPreference.upsert({
      where: { userId: session.user.id },
      update: {
        concurrencyMode: concurrencyMode || undefined,
        maxConcurrent: maxConcurrent || undefined,
      },
      create: {
        userId: session.user.id,
        concurrencyMode: concurrencyMode || "PARALLEL",
        maxConcurrent: maxConcurrent || 3,
      },
    });

    return NextResponse.json({ preference, success: true });
  } catch (error) {
    log.error("Update preferences error:", error);
    return NextResponse.json({ error: "更新偏好设置失败" }, { status: 500 });
  }
}
