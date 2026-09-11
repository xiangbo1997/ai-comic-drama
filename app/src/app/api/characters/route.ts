import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  parseCursor,
  parsePageLimit,
  sliceCursorPage,
} from "@/types/pagination";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:characters");

/**
 * 获取用户的角色列表。
 *
 * 双形状契约（向后兼容，见 types/pagination.ts）：
 *  - 不带 `limit` → 旧版全量裸数组 `CharacterListItem[]`（编辑器角色选择器等
 *    需要「项目全部角色」的调用方继续走这条路径，零回归）；
 *  - 带 `limit`   → `{ items: CharacterListItem[], nextCursor: string | null }`。
 *
 * 查询参数：`?cursor=<characterId>&limit=<1..100>&search=<名称关键词>&tags=<tagId,...>`。
 * `search` / `tags` 一直是服务端过滤，分页只是在其之上再切页。
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const tags = searchParams.get("tags"); // tagId 列表，逗号分隔
    const limit = parsePageLimit(searchParams.get("limit"));
    const cursor = parseCursor(searchParams.get("cursor"));

    const tagIds = tags?.split(",").filter(Boolean) ?? [];

    // 构建查询条件（用 Prisma 生成的 WhereInput，避免 any 绕过类型）
    const where: Prisma.CharacterWhereInput = {
      userId: session.user.id,
      // 搜索关键词（匹配名称）
      ...(search?.trim()
        ? { name: { contains: search.trim(), mode: "insensitive" as const } }
        : {}),
      // Tag 筛选
      ...(tagIds.length > 0
        ? { tags: { some: { tagId: { in: tagIds } } } }
        : {}),
    };

    const rows = await prisma.character.findMany({
      where,
      ...(limit === null
        ? {}
        : {
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          }),
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        appearance: true,
        // 三视图等参考资产（供独立三联展示与生视频多参考）
        referenceAssets: {
          orderBy: { createdAt: "desc" },
        },
      },
      // updatedAt 可能重复，叠加 id 保证游标序确定
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    if (limit === null) return NextResponse.json(rows);
    return NextResponse.json(sliceCursorPage(rows, limit));
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
              // 美术工业一致性 6 项：漏写会让表单填的值静默丢失（与 clothingPresets 同类根因）
              defaultOutfit: appearance.defaultOutfit || null,
              outfitDetails: appearance.outfitDetails || null,
              headToBodyRatio: appearance.headToBodyRatio || null,
              hairParting: appearance.hairParting || null,
              eyeHighlight: appearance.eyeHighlight || null,
              asymmetry: appearance.asymmetry || null,
              // 换装预设：前端 appearance-editor 收集、下游出图/换装消费，
              // 此前漏写导致用户手填/AI 起草的服装预设静默丢失（A1 根因）。
              // 空数组存 []（非 JsonNull），与消费侧 toAppearanceFormData / character-look
              // 统一按空数组处理，避免 null/[] 语义分裂。
              clothingPresets: Array.isArray(appearance.clothingPresets)
                ? appearance.clothingPresets
                : [],
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
