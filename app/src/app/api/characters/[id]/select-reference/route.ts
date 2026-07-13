import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:characters:select-reference");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** CharacterReferenceAsset 表 / 列缺失（未跑新迁移的本地环境）时的容错判定 */
function isReferenceAssetSchemaMismatch(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("characterreferenceasset") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

/**
 * POST /api/characters/[id]/select-reference { imageUrl }
 *
 * 把用户在多候选画廊点选的一张参考图入库（批次 2 · 1.4B）。
 * 候选图已在生成阶段上传存储并扣过费，本端点只负责持久化选中张，不扣费。
 * 追加到 referenceImages 末尾（保持 [0] 为定妆照不变），并写一条
 * CharacterReferenceAsset。首张时补设为 canonical 定妆锚。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { imageUrl } = (await request.json().catch(() => ({}))) as {
      imageUrl?: string;
    };
    if (!imageUrl || typeof imageUrl !== "string") {
      return NextResponse.json(
        { error: "imageUrl is required" },
        { status: 400 }
      );
    }

    // 归属校验
    const character = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, referenceImages: true },
    });
    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 幂等：已存在则直接返回（用户误重复点选不重复写库）
    if (character.referenceImages.includes(imageUrl)) {
      return NextResponse.json({ imageUrl, alreadyExists: true });
    }

    const isFirstImage = character.referenceImages.length === 0;

    // 写 CharacterReferenceAsset（带 schema 容错，兼容未迁移的本地环境）
    try {
      await prisma.characterReferenceAsset.create({
        data: {
          characterId: id,
          url: imageUrl,
          sourceType: isFirstImage ? "canonical" : "ai_generated",
          isCanonical: isFirstImage,
          pose: isFirstImage ? "front" : null,
        },
      });
    } catch (assetError) {
      if (!isReferenceAssetSchemaMismatch(assetError)) throw assetError;
      log.warn(
        "CharacterReferenceAsset schema missing, fallback to legacy referenceImages only",
        assetError
      );
    }

    // 追加到 referenceImages 末尾；首张时同步初始化 canonicalImageUrl 定妆锚
    // （与三视图/首图定妆语义一致，供出图编排器消费）
    const updated = await prisma.character.update({
      where: { id },
      data: {
        referenceImages: isFirstImage
          ? [imageUrl]
          : [...character.referenceImages, imageUrl],
        ...(isFirstImage ? { canonicalImageUrl: imageUrl } : {}),
      },
    });

    return NextResponse.json({ imageUrl, character: updated });
  } catch (error) {
    log.error("Select reference image error:", error);
    return NextResponse.json(
      { error: "保存参考图失败，请稍后重试" },
      { status: 500 }
    );
  }
}
