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
        _count: { select: { scenes: true } },
        scenes: {
          take: 1,
          orderBy: { order: "asc" },
          select: { imageUrl: true },
        },
      },
    });

    // 各项目各媒体完成数：一次 groupBy 统计所有项目，避免逐项目 N 次 count。
    // 供列表卡展示轻量管线进度点，让用户一眼看出「哪个项目就差配音」（a5 P1-6）。
    const projectIds = projects.map((p) => p.id);
    const [imgCounts, vidCounts, audCounts, speakableCounts] =
      await Promise.all([
        prisma.scene.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projectIds }, imageUrl: { not: null } },
          _count: true,
        }),
        prisma.scene.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projectIds }, videoUrl: { not: null } },
          _count: true,
        }),
        prisma.scene.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projectIds }, audioUrl: { not: null } },
          _count: true,
        }),
        prisma.scene.groupBy({
          by: ["projectId"],
          where: {
            projectId: { in: projectIds },
            OR: [{ dialogue: { not: null } }, { narration: { not: null } }],
          },
          _count: true,
        }),
      ]);
    const toMap = (rows: { projectId: string; _count: number }[]) =>
      new Map(rows.map((r) => [r.projectId, r._count]));
    const imgMap = toMap(imgCounts);
    const vidMap = toMap(vidCounts);
    const audMap = toMap(audCounts);
    const speakableMap = toMap(speakableCounts);

    const result = projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      style: p.style,
      aspectRatio: p.aspectRatio,
      scenesCount: p._count.scenes,
      // 管线各步完成数（列表卡进度点用）
      imageCount: imgMap.get(p.id) ?? 0,
      videoCount: vidMap.get(p.id) ?? 0,
      audioCount: audMap.get(p.id) ?? 0,
      speakableCount: speakableMap.get(p.id) ?? 0,
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
