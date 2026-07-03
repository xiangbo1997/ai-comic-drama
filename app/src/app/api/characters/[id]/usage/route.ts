/**
 * 角色引用情况查询 API
 *
 * GET /api/characters/[id]/usage
 * 返回该角色被多少项目（ProjectCharacter）与分镜（selectedCharacterId /
 * selectedCharacterIds 数组）引用。前端在删除角色前调用，把「删除后这些
 * 分镜将失去该角色」的级联后果讲清楚，替代此前的泛化二次确认。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:characters:[id]:usage");

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证角色归属，禁止探测他人角色
    const existing = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "角色不存在" }, { status: 404 });
    }

    const [projectCount, sceneCount] = await Promise.all([
      prisma.projectCharacter.count({ where: { characterId: id } }),
      prisma.scene.count({
        where: {
          OR: [
            { selectedCharacterId: id },
            { selectedCharacterIds: { has: id } },
          ],
        },
      }),
    ]);

    return NextResponse.json({ projectCount, sceneCount });
  } catch (error) {
    log.error("Get character usage error:", error);
    return NextResponse.json(
      { error: "获取角色使用情况失败" },
      { status: 500 }
    );
  }
}
