import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:scenes");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 根据名称查找项目中的角色（支持模糊匹配）
 */
async function findCharacterByName(
  projectId: string,
  characterName: string
): Promise<{ id: string } | null> {
  // 1. 精确匹配（忽略大小写）
  let character = await prisma.character.findFirst({
    where: {
      projects: { some: { projectId } },
      name: { mode: "insensitive", equals: characterName },
    },
    select: { id: true },
  });

  // 2. 模糊匹配（角色名称包含输入的名称）
  if (!character) {
    character = await prisma.character.findFirst({
      where: {
        projects: { some: { projectId } },
        name: { mode: "insensitive", contains: characterName },
      },
      select: { id: true },
    });
  }

  // 3. 反向模糊匹配（输入的名称包含角色名称）
  if (!character) {
    const allCharacters = await prisma.character.findMany({
      where: { projects: { some: { projectId } } },
      select: { id: true, name: true },
    });

    const matched = allCharacters.find((c) =>
      characterName.toLowerCase().includes(c.name.toLowerCase())
    );
    if (matched) {
      character = { id: matched.id };
    }
  }

  return character;
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

    // 删除现有分镜
    await prisma.scene.deleteMany({
      where: { projectId: id },
    });

    // 创建新的分镜，同时处理角色匹配
    const createdScenes = [];

    for (let i = 0; i < scenes.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene = scenes[i] as any;

      // 查找场景中的角色（通过角色名称匹配）
      const sceneCharacters = scene.characters || [];
      let selectedCharacterId: string | null = null;

      // 为每个场景匹配角色并创建关联
      for (const characterName of sceneCharacters) {
        const character = await findCharacterByName(id, characterName);
        if (character) {
          // 第一个匹配的角色设为选中的角色（用于图像生成）
          if (!selectedCharacterId) {
            selectedCharacterId = character.id;
          }
        }
      }

      const createdScene = await prisma.scene.create({
        data: {
          projectId: id,
          order: i,
          shotType: scene.shotType || null,
          description: scene.description || "",
          dialogue: scene.dialogue || null,
          narration: scene.narration || null,
          emotion: scene.emotion || "neutral",
          duration: scene.duration || 3,
          selectedCharacterId, // 自动选择第一个匹配的角色
        },
      });

      createdScenes.push(createdScene);
    }

    return NextResponse.json(createdScenes, { status: 201 });
  } catch (error) {
    log.error("Create scenes error:", error);
    return NextResponse.json(
      { error: "Failed to create scenes" },
      { status: 500 }
    );
  }
}
