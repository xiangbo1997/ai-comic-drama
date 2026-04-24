import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:characters");

// 获取用户的所有角色
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const tags = searchParams.get("tags"); // tagId 列表，逗号分隔

    // 构建查询条件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      userId: session.user.id,
    };

    // 搜索关键词（匹配名称）
    if (search?.trim()) {
      where.name = {
        contains: search.trim(),
        mode: "insensitive",
      };
    }

    // Tag 筛选
    if (tags) {
      const tagIds = tags.split(",").filter(Boolean);
      if (tagIds.length > 0) {
        where.tags = {
          some: {
            tagId: {
              in: tagIds,
            },
          },
        };
      }
    }

    const characters = await prisma.character.findMany({
      where,
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        appearance: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(characters);
  } catch (error) {
    log.error("Get characters error:", error);
    return NextResponse.json(
      { error: "Failed to get characters" },
      { status: 500 }
    );
  }
}

// 创建新角色
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const character = await prisma.character.create({
      data: {
        name,
        gender: gender || null,
        age: age || null,
        description: description || null,
        voiceId: voiceId || null,
        voiceProvider: voiceProvider || null,
        referenceImages: referenceImages || [],
        userId: session.user.id,
        ...(tagIds &&
          tagIds.length > 0 && {
            tags: {
              create: tagIds.map((tagId: string) => ({
                tagId,
              })),
            },
          }),
        ...(appearance && {
          appearance: {
            create: {
              hairStyle: appearance.hairStyle || null,
              hairColor: appearance.hairColor || null,
              faceShape: appearance.faceShape || null,
              eyeColor: appearance.eyeColor || null,
              bodyType: appearance.bodyType || null,
              height: appearance.height || null,
              skinTone: appearance.skinTone || null,
              accessories: appearance.accessories || null,
              freeText: appearance.freeText || null,
            },
          },
        }),
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

    return NextResponse.json(character, { status: 201 });
  } catch (error) {
    log.error("Create character error:", error);
    return NextResponse.json(
      { error: "Failed to create character" },
      { status: 500 }
    );
  }
}
