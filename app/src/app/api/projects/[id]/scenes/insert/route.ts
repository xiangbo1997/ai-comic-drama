import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:scenes:insert");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 在指定分镜后插入一个空白分镜
 * POST /api/projects/[id]/scenes/insert
 * body: { afterSceneId?: string }
 *   - 提供 afterSceneId：在该分镜之后插入（order = afterScene.order + 1）
 *   - 不提供 afterSceneId：追加到末尾（order = max(order) + 1）
 * 新分镜默认值：description="新分镜"、duration=3、emotion="neutral"
 * 返回：新建的分镜
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

    const body = await request.json().catch(() => ({}));
    const { afterSceneId } = body as { afterSceneId?: string };

    let insertOrder: number;

    if (afterSceneId) {
      // 查找指定分镜，确认归属该项目
      const afterScene = await prisma.scene.findFirst({
        where: { id: afterSceneId, projectId: id },
        select: { order: true },
      });

      if (!afterScene) {
        return NextResponse.json(
          { error: "afterSceneId not found in project" },
          { status: 400 }
        );
      }

      insertOrder = afterScene.order + 1;
    } else {
      // 追加到末尾：取当前最大 order + 1
      const lastScene = await prisma.scene.findFirst({
        where: { projectId: id },
        orderBy: { order: "desc" },
        select: { order: true },
      });

      insertOrder = lastScene ? lastScene.order + 1 : 0;
    }

    // 事务：腾位 + 插入
    const newScene = await prisma.$transaction(async (tx) => {
      if (afterSceneId) {
        // 将 insertOrder 及之后的分镜 order+1 腾位
        await tx.scene.updateMany({
          where: {
            projectId: id,
            order: { gte: insertOrder },
          },
          data: { order: { increment: 1 } },
        });
      }

      // 创建空白分镜
      return tx.scene.create({
        data: {
          projectId: id,
          order: insertOrder,
          description: "新分镜",
          duration: 3,
          emotion: "neutral",
          imageStatus: "PENDING",
          videoStatus: "PENDING",
          audioStatus: "PENDING",
        },
      });
    });

    return NextResponse.json(newScene, { status: 201 });
  } catch (error) {
    log.error("Insert scene error:", error);
    return NextResponse.json(
      { error: "Failed to insert scene" },
      { status: 500 }
    );
  }
}
