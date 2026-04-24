import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:scenes:[sceneId]");

interface RouteParams {
  params: Promise<{ id: string; sceneId: string }>;
}

// 更新单个分镜
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id, sceneId } = await params;

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
    const {
      order,
      shotType,
      description,
      dialogue,
      narration,
      emotion,
      duration,
      imageUrl,
      videoUrl,
      audioUrl,
      imageStatus,
      videoStatus,
      audioStatus,
      selectedCharacterId,
      selectedCharacterIds,
    } = body;

    const scene = await prisma.scene.update({
      where: { id: sceneId, projectId: id },
      data: {
        ...(order !== undefined && { order }),
        ...(shotType !== undefined && { shotType }),
        ...(description !== undefined && { description }),
        ...(dialogue !== undefined && { dialogue }),
        ...(narration !== undefined && { narration }),
        ...(emotion !== undefined && { emotion }),
        ...(duration !== undefined && { duration }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(videoUrl !== undefined && { videoUrl }),
        ...(audioUrl !== undefined && { audioUrl }),
        ...(imageStatus !== undefined && { imageStatus }),
        ...(videoStatus !== undefined && { videoStatus }),
        ...(audioStatus !== undefined && { audioStatus }),
        ...(selectedCharacterId !== undefined && { selectedCharacterId }),
        ...(selectedCharacterIds !== undefined && { selectedCharacterIds }),
      },
    });

    return NextResponse.json(scene);
  } catch (error) {
    log.error("Update scene error:", error);
    return NextResponse.json(
      { error: "Failed to update scene" },
      { status: 500 }
    );
  }
}

// 删除单个分镜
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id, sceneId } = await params;

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

    await prisma.scene.delete({
      where: { id: sceneId, projectId: id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete scene error:", error);
    return NextResponse.json(
      { error: "Failed to delete scene" },
      { status: 500 }
    );
  }
}
