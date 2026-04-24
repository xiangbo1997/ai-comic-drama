import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects");

// 获取项目列表
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projects = await prisma.project.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { scenes: true },
        },
        scenes: {
          take: 1,
          orderBy: { order: "asc" },
          select: { imageUrl: true },
        },
      },
    });

    const result = projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      style: p.style,
      aspectRatio: p.aspectRatio,
      scenesCount: p._count.scenes,
      thumbnail: p.scenes[0]?.imageUrl || null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    return NextResponse.json(result);
  } catch (error) {
    log.error("Get projects error:", error);
    return NextResponse.json(
      { error: "Failed to get projects" },
      { status: 500 }
    );
  }
}

// 创建新项目
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, style, aspectRatio } = body;

    const project = await prisma.project.create({
      data: {
        title: title || "未命名项目",
        description: description || null,
        style: style || "anime",
        aspectRatio: aspectRatio || "9:16",
        userId: session.user.id,
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    log.error("Create project error:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
