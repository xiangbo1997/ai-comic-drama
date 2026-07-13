/**
 * GET /api/projects/[id]/locations
 *
 * 场景地点合并视图（计划 §5 · 2.2）：把项目分镜里出现过的地点（Scene.locationKey 去重）
 * 与已建的 ProjectLocation 行左连接，返回每地点的分镜数 + 描述 + 锚图 url + 行 id。
 * 纯读取，无副作用、不扣积分。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  mergeLocations,
  type LocationScene,
  type LocationRow,
} from "@/services/generation/location-plate";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:projects:[id]:locations");

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const [scenes, rows] = await Promise.all([
      prisma.scene.findMany({
        where: { projectId: id },
        select: { id: true, order: true, locationKey: true, description: true },
      }),
      prisma.projectLocation.findMany({
        where: { projectId: id },
        select: {
          id: true,
          locationKey: true,
          description: true,
          imageUrl: true,
        },
      }),
    ]);

    const locations = mergeLocations(
      scenes as LocationScene[],
      rows as LocationRow[]
    );
    return NextResponse.json({ locations });
  } catch (error) {
    log.error("List locations error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取场景地点失败" },
      { status: 500 }
    );
  }
}
