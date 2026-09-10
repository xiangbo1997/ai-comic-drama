import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { applyCanonicalAnchor } from "@/lib/canonical-anchor";
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
 * POST /api/characters/[id]/select-reference { imageUrl, setCanonical? }
 *
 * 把用户在多候选画廊点选的一张参考图入库（批次 2 · 1.4B）。
 * 候选图已在生成阶段上传存储并扣过费，本端点只负责持久化选中张，不扣费。
 * 追加到 referenceImages 末尾（保持 [0] 为定妆照不变），并写一条
 * CharacterReferenceAsset。首张时补设为 canonical 定妆锚。
 *
 * `setCanonical: true`（批 5 · H1）= 用户在角色卡上显式点了「设为定妆照」，
 * 即使已有锚也强制改锚。此前**没有任何端点能改已有锚**，锚是谁完全由生成
 * 顺序决定：先出一张角色设定拼贴图占了锚位，之后生成的干净正面三视图就再
 * 也当不上锚（拼贴图一图多视角 + 混道具静物，喂模型时模型不知复现哪个）。
 * 显式入参而不是「有 imageUrl 就改」，是为了不让画廊点选路径（选的是刚抽的
 * 候选，未必想改锚）意外顶掉用户既有的定妆照。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { imageUrl, setCanonical } = (await request
      .json()
      .catch(() => ({}))) as {
      imageUrl?: string;
      setCanonical?: boolean;
    };
    if (!imageUrl || typeof imageUrl !== "string") {
      return NextResponse.json(
        { error: "imageUrl is required" },
        { status: 400 }
      );
    }

    // 归属校验：与本路由既有写法一致，只能操作自己的角色（越权即 404，不泄露存在性）
    const character = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, referenceImages: true, canonicalImageUrl: true },
    });
    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 显式改锚（H1）：与「补锚」分开处理——补锚只在锚为空时发生且顺带入库新图，
    // 改锚则是对**已在库**的图重新指派，两处 isCanonical 必须一起翻。
    const forceCanonical = setCanonical === true;
    if (forceCanonical) {
      if (character.canonicalImageUrl === imageUrl) {
        // 幂等：已是定妆锚，直接返回（仍回传角色，供前端刷新缓存）
        return NextResponse.json({
          imageUrl,
          canonicalUpdated: false,
          alreadyCanonical: true,
        });
      }

      // 只允许把「本角色已有的图」提为定妆锚：先看 referenceImages，再看资产表
      //（三视图只落资产表，不进 referenceImages 的历史数据也在此兜住）。
      // 资产表缺失时把查询按「查不到」处理，不吞真实 DB 故障——否则一次连接抖动
      // 会被误报成「图片不属于该角色」，用户以为是自己选错了图。
      let isKnownImage = character.referenceImages.includes(imageUrl);
      if (!isKnownImage) {
        try {
          const asset = await prisma.characterReferenceAsset.findFirst({
            where: { characterId: id, url: imageUrl },
            select: { id: true },
          });
          isKnownImage = asset !== null;
        } catch (lookupError) {
          if (!isReferenceAssetSchemaMismatch(lookupError)) throw lookupError;
          log.warn(
            "CharacterReferenceAsset schema missing, skip asset ownership lookup",
            lookupError
          );
        }
      }
      if (!isKnownImage) {
        // 杜绝借本端点把任意外部 URL 写成定妆锚（该 URL 会被直接喂给出图模型）
        return NextResponse.json(
          { error: "该图片不属于当前角色，无法设为定妆照" },
          { status: 400 }
        );
      }

      try {
        const updated = await prisma.$transaction(async (tx) => {
          await applyCanonicalAnchor(tx, id, imageUrl);
          return tx.character.findUniqueOrThrow({ where: { id } });
        });
        log.info("定妆锚已按用户选择更新", { characterId: id });
        return NextResponse.json({
          imageUrl,
          canonicalUpdated: true,
          character: updated,
        });
      } catch (anchorError) {
        if (!isReferenceAssetSchemaMismatch(anchorError)) throw anchorError;
        // 资产表缺失（未迁移的本地环境）：退化为只写 Character 字段
        log.warn(
          "CharacterReferenceAsset schema missing, canonical anchor falls back to Character field only",
          anchorError
        );
        const patched = await prisma.character.update({
          where: { id },
          data: { canonicalImageUrl: imageUrl },
        });
        return NextResponse.json({
          imageUrl,
          canonicalUpdated: true,
          character: patched,
        });
      }
    }

    // 是否需要补写定妆锚：判据是「canonicalImageUrl 为空」，而不是「这是第一张图」。
    // 原判据 referenceImages.length === 0 会漏掉一整类角色——历史数据、上传过垫图、
    // 或早期生成过参考图但从未定稿的角色，它们 referenceImages 非空而
    // canonicalImageUrl 为 null。这类角色走完整条补锚流程后 canonical 仍是 null，
    // 门禁继续报「未定稿」，用户花了积分却看不出哪里没做对。
    // 且 PATCH /api/characters/[id] 的白名单不收 canonicalImageUrl，没有任何
    // 其它端点能把已有图提为定妆锚，纯客户端无路可走。
    const needsCanonical = !character.canonicalImageUrl;
    const isFirstImage = character.referenceImages.length === 0;

    // 幂等：图已在库里则不重复追加，但仍要补齐缺失的定妆锚——
    // 否则用户重复点选同一张时永远补不上锚（这正是上面那类角色的常见操作）。
    if (character.referenceImages.includes(imageUrl)) {
      if (needsCanonical) {
        // 走 applyCanonicalAnchor 而不是裸 update：此前这条分支只写
        // Character.canonicalImageUrl，资产表的 isCanonical 一直是 false，
        // 于是自动 workflow（优先读 isCanonical 资产）与手动路径锚到不同的图。
        let patched;
        try {
          patched = await prisma.$transaction(async (tx) => {
            await applyCanonicalAnchor(tx, id, imageUrl);
            return tx.character.findUniqueOrThrow({ where: { id } });
          });
        } catch (anchorError) {
          if (!isReferenceAssetSchemaMismatch(anchorError)) throw anchorError;
          log.warn(
            "CharacterReferenceAsset schema missing, canonical anchor falls back to Character field only",
            anchorError
          );
          patched = await prisma.character.update({
            where: { id },
            data: { canonicalImageUrl: imageUrl },
          });
        }
        log.info("已有参考图补设为定妆锚（幂等路径）", {
          characterId: id,
        });
        return NextResponse.json({
          imageUrl,
          alreadyExists: true,
          canonicalUpdated: true,
          character: patched,
        });
      }
      return NextResponse.json({ imageUrl, alreadyExists: true });
    }

    // 写 CharacterReferenceAsset（带 schema 容错，兼容未迁移的本地环境）
    try {
      await prisma.characterReferenceAsset.create({
        data: {
          characterId: id,
          url: imageUrl,
          // 与 Character.canonicalImageUrl 的补写判据保持一致：这张图成为定妆锚时，
          // 资产表也要标 canonical，否则两处对「谁是定妆照」的认定会分叉
          sourceType: needsCanonical ? "canonical" : "ai_generated",
          isCanonical: needsCanonical,
          pose: needsCanonical ? "front" : null,
        },
      });
    } catch (assetError) {
      if (!isReferenceAssetSchemaMismatch(assetError)) throw assetError;
      log.warn(
        "CharacterReferenceAsset schema missing, fallback to legacy referenceImages only",
        assetError
      );
    }

    // 追加到 referenceImages 末尾；canonicalImageUrl 为空时补设定妆锚
    // （与三视图/首图定妆语义一致，供出图编排器消费）。
    // 注意判据用 needsCanonical 而非 isFirstImage，见上方注释。
    const updated = await prisma.character.update({
      where: { id },
      data: {
        referenceImages: isFirstImage
          ? [imageUrl]
          : [...character.referenceImages, imageUrl],
        ...(needsCanonical ? { canonicalImageUrl: imageUrl } : {}),
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
