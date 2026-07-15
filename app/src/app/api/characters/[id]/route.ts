import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:characters:[id]");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个角色
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const character = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        appearance: true,
      },
    });

    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(character);
  } catch (error) {
    log.error("Get character error:", error);
    return NextResponse.json(
      { error: "Failed to get character" },
      { status: 500 }
    );
  }
}

// 更新角色
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证角色归属
    const existing = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      name,
      gender,
      age,
      description,
      voiceId,
      voiceProvider,
      referenceImages,
      tagIds,
      appearance,
    } = body;

    // 如果有 tagIds，需要使用事务来处理
    if (tagIds !== undefined) {
      await prisma.$transaction(async (tx) => {
        await tx.characterTag.deleteMany({
          where: { characterId: id },
        });
        if (tagIds.length > 0) {
          await tx.characterTag.createMany({
            data: tagIds.map((tagId: string) => ({
              characterId: id,
              tagId,
            })),
          });
        }
      });
    }

    // 如果有 appearance，upsert 结构化外貌数据
    if (appearance !== undefined) {
      if (appearance === null) {
        // 删除外貌数据
        await prisma.characterAppearance.deleteMany({
          where: { characterId: id },
        });
      } else {
        // 换装预设：空数组统一存 []（非 JsonNull），与消费侧 toAppearanceFormData /
        // character-look 一致按空数组处理，避免 null/[] 语义分裂（A1）。
        const clothingPresets = Array.isArray(appearance.clothingPresets)
          ? appearance.clothingPresets
          : [];
        await prisma.characterAppearance.upsert({
          where: { characterId: id },
          create: {
            characterId: id,
            hairStyle: appearance.hairStyle || null,
            hairColor: appearance.hairColor || null,
            faceShape: appearance.faceShape || null,
            eyeColor: appearance.eyeColor || null,
            bodyType: appearance.bodyType || null,
            height: appearance.height || null,
            skinTone: appearance.skinTone || null,
            accessories: appearance.accessories || null,
            freeText: appearance.freeText || null,
            clothingPresets,
          },
          update: {
            hairStyle: appearance.hairStyle || null,
            hairColor: appearance.hairColor || null,
            faceShape: appearance.faceShape || null,
            eyeColor: appearance.eyeColor || null,
            bodyType: appearance.bodyType || null,
            height: appearance.height || null,
            skinTone: appearance.skinTone || null,
            accessories: appearance.accessories || null,
            freeText: appearance.freeText || null,
            clothingPresets,
          },
        });
      }
    }

    const character = await prisma.character.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(gender !== undefined && { gender }),
        ...(age !== undefined && { age }),
        ...(description !== undefined && { description }),
        ...(voiceId !== undefined && { voiceId }),
        ...(voiceProvider !== undefined && { voiceProvider }),
        ...(referenceImages !== undefined && { referenceImages }),
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        appearance: true,
      },
    });

    return NextResponse.json(character);
  } catch (error) {
    log.error("Update character error:", error);
    return NextResponse.json(
      { error: "Failed to update character" },
      { status: 500 }
    );
  }
}

// 删除角色
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证角色归属
    const existing = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 事务：删角色 + 清理各分镜 selectedCharacterIds 数组中的悬垂 ID。
    // selectedCharacterId（单选）有 onDelete: SetNull 自动清；但
    // selectedCharacterIds（String[]）是无外键的原生数组，需手动 array_remove，
    // 否则删角色后分镜仍引用死 ID → 出图时静默少一角色 / 参考图缺失。
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE "Scene"
        SET "selectedCharacterIds" = array_remove("selectedCharacterIds", ${id})
        WHERE ${id} = ANY("selectedCharacterIds")
      `,
      prisma.character.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete character error:", error);
    return NextResponse.json(
      { error: "Failed to delete character" },
      { status: 500 }
    );
  }
}
