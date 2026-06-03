import { auth } from "@/lib/auth";
import { getUserImageConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { generateImage } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { createLogger } from "@/lib/logger";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import {
  buildCharacterBasePrompt,
  POSE_CONSTRAINTS,
} from "@/lib/prompts/character-reference";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:characters:generate-three-views");

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PER_VIEW_COST = 3;
const POSES = ["front", "side", "back"] as const;
const THREE_VIEW_COST = PER_VIEW_COST * POSES.length; // 9

const BodySchema = z.object({
  imageConfigId: z.string().max(255).optional(),
});

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
 * POST /api/characters/[id]/generate-three-views
 *
 * 一键生成角色 正/侧/背 三视图（防生成崩坏）。每个视角注入 POSE_CONSTRAINTS，
 * 串行生成（防限流），每张正确标注 pose，统一事务扣费 9 积分。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    const imageConfigId = parsed.success
      ? parsed.data.imageConfigId
      : undefined;

    // 角色归属
    const character = await prisma.character.findFirst({
      where: { id, userId },
      include: { tags: { include: { tag: true } } },
    });
    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 积分预检
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user || user.credits < THREE_VIEW_COST) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: THREE_VIEW_COST,
          current: user?.credits ?? 0,
        },
        { status: 400 }
      );
    }

    const imageConfig = await getUserImageConfig(userId, imageConfigId);
    if (imageConfigId && !imageConfig) {
      return NextResponse.json(
        { error: "所选图片供应商不可用，请重新选择已测试成功的图像模型配置。" },
        { status: 400 }
      );
    }

    const basePrompt = buildCharacterBasePrompt(character);

    // 串行生成三视图（防限流）
    const results: { pose: string; url: string }[] = [];
    for (const pose of POSES) {
      const prompt = `${basePrompt}, ${POSE_CONSTRAINTS[pose]}`;
      let imageUrl = await generateImage({
        prompt,
        aspectRatio: "1:1",
        config: imageConfig || undefined,
      });

      if (isStorageConfigured()) {
        try {
          imageUrl = await uploadFileFromUrl(imageUrl, {
            fileName: `character_${id}_${pose}_${Date.now()}.webp`,
            contentType: "image/webp",
            fileType: "image",
            userId,
          });
        } catch (uploadError) {
          log.error(
            `Failed to save ${pose} view, using external URL:`,
            uploadError
          );
        }
      }
      results.push({ pose, url: imageUrl });
    }

    // 落库 + 扣费（事务）。CharacterReferenceAsset 写入带 schema 容错。
    await prisma.$transaction(async (tx) => {
      for (const { pose, url } of results) {
        try {
          await tx.characterReferenceAsset.create({
            data: {
              characterId: id,
              url,
              sourceType: "ai_generated",
              isCanonical: false,
              pose,
            },
          });
        } catch (assetError) {
          if (!isReferenceAssetSchemaMismatch(assetError)) throw assetError;
          log.warn(
            "CharacterReferenceAsset schema missing, skip asset row",
            assetError
          );
        }
      }
      await chargeCredits(tx, {
        userId,
        amount: THREE_VIEW_COST,
        type: "GENERATE_REFERENCE",
        source: "character:three-views",
        sourceId: id,
        note: `角色三视图（${character.name}）`,
      });
    });

    return NextResponse.json({
      views: results,
      cost: THREE_VIEW_COST,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: "积分不足", required: THREE_VIEW_COST },
        { status: 400 }
      );
    }
    log.error("Generate three views error:", error);
    return NextResponse.json(
      { error: "生成三视图失败，请稍后重试" },
      { status: 500 }
    );
  }
}
