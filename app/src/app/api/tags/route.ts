import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:tags");

// 获取所有标签（系统预设 + 用户自定义）
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    // 获取系统预设标签和用户自定义标签
    const tags = await prisma.tag.findMany({
      where: {
        OR: [
          { isSystem: true }, // 系统预设
          { userId: session.user.id }, // 用户自定义
        ],
        ...(category && { category }),
      },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(tags);
  } catch (error) {
    log.error("Get tags error:", error);
    return NextResponse.json({ error: "Failed to get tags" }, { status: 500 });
  }
}

// 创建自定义标签
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, category, color } = await request.json();

    if (!name?.trim()) {
      return NextResponse.json({ error: "标签名称不能为空" }, { status: 400 });
    }

    // 检查是否已存在同名标签（系统或用户自定义）
    const existingTag = await prisma.tag.findFirst({
      where: {
        name: name.trim(),
        OR: [{ isSystem: true }, { userId: session.user.id }],
      },
    });

    if (existingTag) {
      return NextResponse.json({ error: "标签名称已存在" }, { status: 400 });
    }

    const tag = await prisma.tag.create({
      data: {
        name: name.trim(),
        category: category || "other",
        color: color || "#6B7280",
        userId: session.user.id,
        isSystem: false,
      },
    });

    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    log.error("Create tag error:", error);
    return NextResponse.json(
      { error: "Failed to create tag" },
      { status: 500 }
    );
  }
}
