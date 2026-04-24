import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:characters");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取项目关联的所有角色
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

    // 获取项目关联的角色
    const projectCharacters = await prisma.projectCharacter.findMany({
      where: { projectId: id },
      include: {
        character: {
          select: {
            id: true,
            name: true,
            gender: true,
            age: true,
            description: true,
            referenceImages: true,
          },
        },
      },
    });

    return NextResponse.json(projectCharacters.map((pc) => pc.character));
  } catch (error) {
    log.error("Get project characters error:", error);
    return NextResponse.json(
      { error: "Failed to get project characters" },
      { status: 500 }
    );
  }
}

// 添加角色到项目
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { characterId } = await request.json();

    if (!characterId) {
      return NextResponse.json(
        { error: "characterId is required" },
        { status: 400 }
      );
    }

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 验证角色归属
    const character = await prisma.character.findFirst({
      where: { id: characterId, userId: session.user.id },
    });

    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 创建关联（如果已存在则忽略）
    const projectCharacter = await prisma.projectCharacter.upsert({
      where: {
        projectId_characterId: {
          projectId: id,
          characterId,
        },
      },
      create: {
        projectId: id,
        characterId,
      },
      update: {},
      include: {
        character: true,
      },
    });

    return NextResponse.json(projectCharacter.character, { status: 201 });
  } catch (error) {
    log.error("Add character to project error:", error);
    return NextResponse.json(
      { error: "Failed to add character to project" },
      { status: 500 }
    );
  }
}

// 批量更新项目角色（替换所有关联）
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { characterIds } = await request.json();

    if (!Array.isArray(characterIds)) {
      return NextResponse.json(
        { error: "characterIds must be an array" },
        { status: 400 }
      );
    }

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 验证所有角色归属
    const characters = await prisma.character.findMany({
      where: {
        id: { in: characterIds },
        userId: session.user.id,
      },
    });

    if (characters.length !== characterIds.length) {
      return NextResponse.json(
        { error: "Some characters not found or not owned by user" },
        { status: 400 }
      );
    }

    // 使用事务批量更新
    await prisma.$transaction(async (tx) => {
      // 删除现有关联
      await tx.projectCharacter.deleteMany({
        where: { projectId: id },
      });

      // 创建新关联
      if (characterIds.length > 0) {
        await tx.projectCharacter.createMany({
          data: characterIds.map((characterId: string) => ({
            projectId: id,
            characterId,
          })),
        });
      }
    });

    // 返回更新后的角色列表
    const updatedCharacters = await prisma.projectCharacter.findMany({
      where: { projectId: id },
      include: {
        character: {
          select: {
            id: true,
            name: true,
            gender: true,
            age: true,
            description: true,
            referenceImages: true,
          },
        },
      },
    });

    return NextResponse.json(updatedCharacters.map((pc) => pc.character));
  } catch (error) {
    log.error("Update project characters error:", error);
    return NextResponse.json(
      { error: "Failed to update project characters" },
      { status: 500 }
    );
  }
}

// 从项目移除角色
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const characterId = searchParams.get("characterId");

    if (!characterId) {
      return NextResponse.json(
        { error: "characterId is required" },
        { status: 400 }
      );
    }

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 删除关联
    await prisma.projectCharacter.deleteMany({
      where: {
        projectId: id,
        characterId,
      },
    });

    // 同时清除场景中对该角色的选择
    await prisma.scene.updateMany({
      where: {
        projectId: id,
        selectedCharacterId: characterId,
      },
      data: {
        selectedCharacterId: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Remove character from project error:", error);
    return NextResponse.json(
      { error: "Failed to remove character from project" },
      { status: 500 }
    );
  }
}
