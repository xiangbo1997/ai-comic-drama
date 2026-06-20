import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:scenes");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 在内存中按名称匹配角色（支持模糊匹配）。
 *
 * 改自原 findCharacterByName 的逐角色 DB 查询版本：批量保存分镜时，
 * 每个分镜的每个角色名都查一次 DB（N+1，~150 次串行往返）。改为
 * POST 入口一次性预加载项目全部角色到内存，逐分镜在内存里匹配。
 */
function matchCharacterByName(
  characters: Array<{ id: string; name: string }>,
  characterName: string
): { id: string } | null {
  const lower = characterName.toLowerCase();
  // 1. 精确匹配（忽略大小写）
  const exact = characters.find((c) => c.name.toLowerCase() === lower);
  if (exact) return { id: exact.id };
  // 2. 模糊匹配（角色名称包含输入的名称）
  const contains = characters.find((c) => c.name.toLowerCase().includes(lower));
  if (contains) return { id: contains.id };
  // 3. 反向模糊匹配（输入的名称包含角色名称）
  const reverse = characters.find((c) => lower.includes(c.name.toLowerCase()));
  return reverse ? { id: reverse.id } : null;
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

    const { scenes } = await request.json();

    if (!Array.isArray(scenes)) {
      return NextResponse.json(
        { error: "Scenes must be an array" },
        { status: 400 }
      );
    }

    // 一次性预加载项目全部角色到内存（消除原逐角色名查 DB 的 N+1）
    const projectCharacters = await prisma.character.findMany({
      where: { projects: { some: { projectId: id } } },
      select: { id: true, name: true },
    });

    // 在内存里完成角色匹配，组装好待插入数据
    const sceneData = scenes.map((raw, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene = raw as any;
      const sceneCharacters: string[] = scene.characters || [];
      let selectedCharacterId: string | null = null;
      for (const characterName of sceneCharacters) {
        const matched = matchCharacterByName(projectCharacters, characterName);
        if (matched) {
          selectedCharacterId = matched.id; // 第一个匹配的角色用于图像生成
          break;
        }
      }
      return {
        projectId: id,
        order: i,
        shotType: scene.shotType || null,
        description: scene.description || "",
        dialogue: scene.dialogue || null,
        narration: scene.narration || null,
        emotion: scene.emotion || "neutral",
        duration: scene.duration || 3,
        selectedCharacterId,
        // 镜头语言：LLM 解析产出，此前落库被丢弃 → 出图缺电影感
        cameraAngle: scene.cameraAngle || null,
        lighting: scene.lighting || null,
        composition: scene.composition || null,
        colorPalette: scene.colorPalette || null,
        cameraMovement: scene.cameraMovement || null,
      };
    });

    // 事务化「删旧 + 建新」：中断则整体回滚，不会出现「删了旧的但新的
    // 没建成」的半残状态导致分镜全丢（arch-data P0-1）。
    await prisma.$transaction([
      prisma.scene.deleteMany({ where: { projectId: id } }),
      ...(sceneData.length > 0
        ? [prisma.scene.createMany({ data: sceneData })]
        : []),
    ]);

    // createMany 不返回记录，按 order 回读新建分镜返回前端
    const createdScenes = await prisma.scene.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
    });

    return NextResponse.json(createdScenes, { status: 201 });
  } catch (error) {
    log.error("Create scenes error:", error);
    return NextResponse.json(
      { error: "Failed to create scenes" },
      { status: 500 }
    );
  }
}
