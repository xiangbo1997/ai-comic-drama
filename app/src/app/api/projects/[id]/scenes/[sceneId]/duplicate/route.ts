import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:scenes:[sceneId]:duplicate");

interface RouteParams {
  params: Promise<{ id: string; sceneId: string }>;
}

/**
 * 复制指定分镜，在其后插入一个副本
 * POST /api/projects/[id]/scenes/[sceneId]/duplicate
 * 副本保留：description、dialogue、narration、emotion、shotType、duration、videoLinkNext、
 *          镜头语言（cameraAngle/lighting/composition/colorPalette）、运镜与运动节拍
 *          （cameraMovement/actionBeat）、地点标签（locationKey）、selectedCharacterId、selectedCharacterIds
 * 副本清空：imageUrl、videoUrl、audioUrl、imageStatus、videoStatus、audioStatus（媒体需重新生成）
 * order 腾位：源分镜 order+1 处插入，其后所有分镜 order+1
 * 返回：新建的分镜
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // 读取源分镜
    const sourceScene = await prisma.scene.findFirst({
      where: { id: sceneId, projectId: id },
    });

    if (!sourceScene) {
      return NextResponse.json({ error: "Scene not found" }, { status: 404 });
    }

    // 副本插入位置：源分镜 order + 1
    const insertOrder = sourceScene.order + 1;

    // 事务：先将 insertOrder 及之后的所有分镜 order+1 腾位，再创建副本
    const newScene = await prisma.$transaction(async (tx) => {
      // 将插入位置及之后的所有分镜 order+1，腾出一个位置
      await tx.scene.updateMany({
        where: {
          projectId: id,
          order: { gte: insertOrder },
        },
        data: { order: { increment: 1 } },
      });

      // 创建副本，复制内容字段，清空媒体 URL 和状态
      return tx.scene.create({
        data: {
          projectId: id,
          order: insertOrder,
          shotType: sourceScene.shotType,
          description: sourceScene.description,
          dialogue: sourceScene.dialogue,
          narration: sourceScene.narration,
          emotion: sourceScene.emotion,
          duration: sourceScene.duration,
          videoLinkNext: sourceScene.videoLinkNext,
          // 镜头语言 + 运镜 + 运动节拍：忠实复制，副本无需重导演
          cameraAngle: sourceScene.cameraAngle,
          lighting: sourceScene.lighting,
          composition: sourceScene.composition,
          colorPalette: sourceScene.colorPalette,
          cameraMovement: sourceScene.cameraMovement,
          actionBeat: sourceScene.actionBeat,
          // 地点标签：副本沿用同一地点，与源分镜共享场景锚定分组
          locationKey: sourceScene.locationKey,
          // 分镜级换装标注（Json）：副本沿用同一换装，与源分镜共享场景定妆照。
          // 源为空时用 JsonNull（Prisma Json 空值语义）。
          characterOutfits:
            sourceScene.characterOutfits === null
              ? Prisma.JsonNull
              : (sourceScene.characterOutfits as Prisma.InputJsonValue),
          selectedCharacterId: sourceScene.selectedCharacterId,
          selectedCharacterIds: sourceScene.selectedCharacterIds,
          // 媒体 URL 和状态清空，副本需重新生成
          imageUrl: null,
          videoUrl: null,
          audioUrl: null,
          imageStatus: "PENDING",
          videoStatus: "PENDING",
          audioStatus: "PENDING",
        },
      });
    });

    return NextResponse.json(newScene, { status: 201 });
  } catch (error) {
    log.error("Duplicate scene error:", error);
    return NextResponse.json(
      { error: "Failed to duplicate scene" },
      { status: 500 }
    );
  }
}
