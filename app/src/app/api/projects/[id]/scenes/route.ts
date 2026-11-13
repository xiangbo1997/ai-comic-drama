import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { rebuildProjectScenes } from "@/services/scene-rebuild";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:scenes");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取项目的所有分镜
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const scenes = await prisma.scene.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
      include: {
        sceneCharacters: {
          include: {
            character: {
              select: {
                id: true,
                name: true,
                description: true,
                referenceImages: true,
                voiceId: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(scenes);
  } catch (error) {
    log.error("Get scenes error:", error);
    return NextResponse.json(
      { error: "Failed to get scenes" },
      { status: 500 }
    );
  }
}

// 批量创建/更新分镜
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

    const { scenes, operationId } = await request.json();

    if (!Array.isArray(scenes)) {
      return NextResponse.json(
        { error: "Scenes must be an array" },
        { status: 400 }
      );
    }

    if (
      operationId !== undefined &&
      (typeof operationId !== "string" ||
        !/^[A-Za-z0-9_:-]{1,128}$/.test(operationId))
    ) {
      return NextResponse.json({ error: "operationId无效" }, { status: 400 });
    }
    if (operationId !== undefined) {
      const inputHash = createHash("sha256")
        .update(JSON.stringify(scenes))
        .digest("hex");
      const result = await prisma.$transaction(
        async (tx) => {
          // 分镜重建与凭证一次提交，响应丢失也能确认原sceneId，不能二次删建。
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-scenes:${id}`}, 0))`;
          const existing = await tx.generationTask.findFirst({
            where: {
              projectId: id,
              type: "SCRIPT_PARSE",
              status: "COMPLETED",
              AND: [
                { input: { path: ["kind"], equals: "producer_scene_apply" } },
                { input: { path: ["userId"], equals: session.user.id } },
                { input: { path: ["operationId"], equals: operationId } },
              ],
            },
            orderBy: { createdAt: "desc" },
          });
          if (existing) {
            const priorInput = existing.input as { inputHash?: unknown };
            const priorOutput = existing.output as {
              sceneIds?: unknown;
            } | null;
            if (priorInput.inputHash !== inputHash)
              return { conflict: true } as const;
            const current = await tx.scene.findMany({
              where: { projectId: id },
              orderBy: { order: "asc" },
            });
            const sceneIds = priorOutput?.sceneIds;
            if (
              !Array.isArray(sceneIds) ||
              sceneIds.length !== current.length ||
              !current.every((scene, index) => scene.id === sceneIds[index])
            )
              return { conflict: true } as const;
            return { scenes: current, reused: true } as const;
          }
          const created = await rebuildProjectScenes(id, project, scenes, tx);
          await tx.generationTask.create({
            data: {
              type: "SCRIPT_PARSE",
              status: "COMPLETED",
              projectId: id,
              input: {
                kind: "producer_scene_apply",
                userId: session.user.id,
                operationId,
                inputHash,
              },
              output: {
                sceneIds: created.map((scene) => scene.id),
              } as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          });
          return { scenes: created, reused: false } as const;
        },
        { timeout: 30_000 }
      );
      if ("conflict" in result)
        return NextResponse.json(
          { error: "该操作已应用于不同内容或分镜已被替换，请进入项目检查" },
          { status: 409 }
        );
      return NextResponse.json(result.scenes, {
        status: result.reused ? 200 : 201,
      });
    }
    const createdScenes = await rebuildProjectScenes(id, project, scenes);

    return NextResponse.json(createdScenes, { status: 201 });
  } catch (error) {
    log.error("Create scenes error:", error);
    return NextResponse.json(
      { error: "Failed to create scenes" },
      { status: 500 }
    );
  }
}
