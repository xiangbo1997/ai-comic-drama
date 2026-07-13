import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { clampSceneDuration } from "@/services/generation/video-segmenter";

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
      ttsSpeed,
      videoLinkNext,
      cameraMovement,
      actionBeat,
      locationKey,
      characterOutfits,
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
        // 时长钳到 1–60 整数：分镜时长上限即视频分段上限，防越界值直达 DB
        ...(duration !== undefined && {
          duration: clampSceneDuration(duration),
        }),
        // 配音语速：夹取到 provider 支持的 0.5–2.0，防越界值直达适配器
        ...(ttsSpeed !== undefined && {
          ttsSpeed: Math.min(2, Math.max(0.5, Number(ttsSpeed) || 1)),
        }),
        // 尾帧衔接下一镜开关：强制布尔化，防任意值直达 DB
        ...(videoLinkNext !== undefined && {
          videoLinkNext: Boolean(videoLinkNext),
        }),
        // 运镜 / 运动节拍：LLM 导演产出，编辑器可手改（喂视频 prompt）
        ...(cameraMovement !== undefined && {
          cameraMovement: cameraMovement || null,
        }),
        ...(actionBeat !== undefined && { actionBeat: actionBeat || null }),
        // 地点标签：LLM 解析产出，编辑器可手改（供场景锚定图分组）
        ...(locationKey !== undefined && { locationKey: locationKey || null }),
        // 分镜级换装标注（Json）：编辑器可手改。有数组用 InputJsonValue，
        // 显式清空 / 空数组用 JsonNull（Prisma Json 空值语义）。
        ...(characterOutfits !== undefined && {
          characterOutfits:
            Array.isArray(characterOutfits) && characterOutfits.length > 0
              ? (characterOutfits as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        }),
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
