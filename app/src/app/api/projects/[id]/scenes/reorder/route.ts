import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
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

    // 单条 UPDATE ... FROM (VALUES ...) 批量改 order：原实现每个分镜发一条
    // UPDATE（拖 50 个分镜即 50 次往返 + 50 个行锁持有到事务末尾），这里压成
    // 一次往返。id 与 order 全部走 Prisma.sql 参数化（无字符串拼接），
    // projectId 条件保留归属校验，双保险防越权改他人分镜。
    const values = Prisma.join(
      sceneIds.map(
        (sceneId, index) => Prisma.sql`(${sceneId}, ${index}::integer)`
      )
    );
    await prisma.$executeRaw`
      UPDATE "Scene" AS s
      SET "order" = v.ord
      FROM (VALUES ${values}) AS v(id, ord)
      WHERE s.id = v.id AND s."projectId" = ${id}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Reorder scenes error:", error);
    return NextResponse.json(
      { error: "Failed to reorder scenes" },
      { status: 500 }
    );
  }
}
