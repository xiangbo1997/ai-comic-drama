import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:scenes:reorder");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 批量更新分镜顺序
 * POST /api/projects/[id]/scenes/reorder
 * body: { orderedIds: string[] } — 按新顺序排列的分镜 id 数组
 * 每个分镜的 order 值更新为其在数组中的索引
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await request.json();
    const { orderedIds } = body as { orderedIds?: unknown };

    // 校验 orderedIds 格式
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json(
        { error: "orderedIds must be a non-empty array" },
        { status: 400 }
      );
    }

    if (!orderedIds.every((id) => typeof id === "string")) {
      return NextResponse.json(
        { error: "orderedIds must be an array of strings" },
        { status: 400 }
      );
    }

    const sceneIds = orderedIds as string[];

    // 校验所有 id 都属于该项目
    const existingScenes = await prisma.scene.findMany({
      where: { projectId: id },
      select: { id: true },
    });

    const existingIds = new Set(existingScenes.map((s) => s.id));
    const invalidIds = sceneIds.filter((sid) => !existingIds.has(sid));

    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: `Scene ids not found in project: ${invalidIds.join(", ")}` },
        { status: 400 }
      );
    }

    // 在事务中批量更新每个分镜的 order 为其在数组中的索引
    await prisma.$transaction(
      sceneIds.map((sceneId, index) =>
        prisma.scene.update({
          where: { id: sceneId, projectId: id },
          data: { order: index },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Reorder scenes error:", error);
    return NextResponse.json(
      { error: "Failed to reorder scenes" },
      { status: 500 }
    );
  }
}
