import { auth } from "@/lib/auth";
import { getUserImageConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { generateImage } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { createLogger } from "@/lib/logger";
import { chargeCredits } from "@/lib/credits";
import { buildCharacterPromptWithCustom } from "@/lib/prompts/character-reference";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:characters:generate-reference");

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isReferenceAssetSchemaMismatch(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("characterreferenceasset") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function toClientErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "生成角色参考图失败，请稍后重试";
  }

  const message = error.message;

  if (message.includes("one_hub_error") && message.includes("dall-e-3")) {
    return "当前图像配置默认使用 dall-e-3，但该中转通道没有可用渠道。请到“设置 > AI 模型配置 > 图像生成”里切换可用模型。";
  }

  if (
    message.includes("Unauthenticated") ||
    message.includes("401 Unauthorized")
  ) {
    return "备用 Replicate 图像通道认证失败，请检查 .env 中的 REPLICATE_API_TOKEN 是否有效。";
  }

  if (message.includes("fetch failed")) {
    return "图像服务连接失败，请检查当前图像提供商的 Base URL、网络连通性或服务可用性。";
  }

  return message;
}

// 为角色生成参考图
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 在事务闭包内 TS 会丢失对 session.user.id 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 解析请求体，获取可选参数
    const body = await request.json().catch(() => ({}));
    const {
      baseImage, // 上传的垫图（base64）
      customPrompt, // 用户自定义提示词
      useExistingImage, // 是否使用角色现有图片作为参考
      existingImageIndex, // 使用哪张现有图片（默认 0）
      imageConfigId,
    } = body as {
      baseImage?: string;
      customPrompt?: string;
      useExistingImage?: boolean;
      existingImageIndex?: number;
      imageConfigId?: string;
    };

    // 验证角色归属
    const character = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 检查积分（使用垫图或现有图片时消耗更多积分）
    const hasReferenceImage = baseImage || useExistingImage;
    const creditCost = hasReferenceImage ? 5 : 3;
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { credits: true },
    });

    if (!user || user.credits < creditCost) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: creditCost,
          current: user?.credits ?? 0,
        },
        { status: 400 }
      );
    }

    // 构建提示词：用户自定义提示词「提权」到最前面并声明最高优先级，
    // 避免被 base prompt 的几十个基础关键词淹没（提示词不生效根因）。
    const basePromptParts = [
      buildCharacterPromptWithCustom(character, customPrompt),
    ];

    // 如果有参考图，添加参考图说明
    if (hasReferenceImage) {
      basePromptParts.push(
        "based on the reference image style, maintain similar art style and character features"
      );
    }

    const prompt = basePromptParts.join(", ");

    log.info("Generating reference image", {
      characterName: character.name,
      hasCustomPrompt: !!customPrompt,
      useExistingImage,
      hasBaseImage: !!baseImage,
    });

    // 获取用户图像生成配置
    const imageConfig = await getUserImageConfig(
      session.user.id,
      imageConfigId
    );

    if (imageConfigId && !imageConfig) {
      return NextResponse.json(
        { error: "所选图片供应商不可用，请重新选择已测试成功的图像模型配置。" },
        { status: 400 }
      );
    }

    // 确定参考图片
    let referenceImage: string | undefined = baseImage;

    // 如果使用现有图片作为参考
    if (useExistingImage && character.referenceImages.length > 0) {
      const imageIndex = existingImageIndex ?? 0;
      if (imageIndex >= 0 && imageIndex < character.referenceImages.length) {
        // 获取现有图片的 URL
        const existingImageUrl = character.referenceImages[imageIndex];
        log.info("Using existing image as reference:", existingImageUrl);

        // 下载图片并转换为 base64
        try {
          const imageResponse = await fetch(existingImageUrl);
          if (imageResponse.ok) {
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64 = Buffer.from(imageBuffer).toString("base64");
            const contentType =
              imageResponse.headers.get("content-type") || "image/png";
            referenceImage = `data:${contentType};base64,${base64}`;
          }
        } catch (fetchError) {
          log.error("Failed to fetch existing image:", fetchError);
          // 继续生成，但不使用参考图
        }
      }
    }

    // 生成图像
    let imageUrl = await generateImage({
      prompt,
      referenceImage,
      aspectRatio: "1:1",
      config: imageConfig || undefined,
    });

    // 保存到存储服务（R2 或本地）
    if (isStorageConfigured()) {
      try {
        const fileName = `character_${id}_${Date.now()}.webp`;
        imageUrl = await uploadFileFromUrl(imageUrl, {
          fileName,
          contentType: "image/webp",
          fileType: "image",
          userId: session.user.id,
        });
        log.info("Image saved to storage:", imageUrl);
      } catch (uploadError) {
        log.error("Failed to save image, using external URL:", uploadError);
        // 降级：继续使用外部 URL
      }
    }

    // 写入新的 CharacterReferenceAsset（不覆盖 canonical 定妆照）
    const isFirstImage = character.referenceImages.length === 0;
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
      // 兼容未执行新迁移的本地环境，避免生成成功后因新表缺失而整体 500。
      if (!isReferenceAssetSchemaMismatch(assetError)) {
        throw assetError;
      }
      log.warn(
        "CharacterReferenceAsset schema missing, fallback to legacy referenceImages only",
        assetError
      );
    }

    // R1：将「角色 referenceImages 更新 + 扣费」包进同一事务，保证原子性。
    // chargeCredits 内部会在事务里再次校验余额并记录积分流水，
    // 余额不足会抛错并自动回滚本次 character 更新。
    // R2：扣费时机为「生成成功后」，失败路径（外层 catch）下用户从未被扣，无需退款。
    // 同步更新旧 referenceImages 数组（兼容遗留代码）
    // 新图片追加到末尾，保持 [0] 为定妆照不变
    const updatedCharacter = await prisma.$transaction(async (tx) => {
      const updated = await tx.character.update({
        where: { id },
        data: {
          referenceImages: isFirstImage
            ? [imageUrl]
            : [...character.referenceImages, imageUrl],
        },
      });

      // 扣减积分（事务内扣费+记流水+余额校验）
      await chargeCredits(tx, {
        userId,
        amount: creditCost,
        type: "GENERATE_REFERENCE",
        source: "characters:generate-reference",
        sourceId: id,
        note: `角色 ${character.name} 参考图生成`,
      });

      return updated;
    });

    return NextResponse.json({
      imageUrl,
      character: updatedCharacter,
      debug: {
        prompt, // 返回实际使用的提示词
        characterData: {
          name: character.name,
          gender: character.gender,
          age: character.age,
          description: character.description,
          tags: character.tags?.map((ct) => ct.tag.name) ?? [],
        },
      },
    });
  } catch (error) {
    log.error("Generate reference image error:", error);
    return NextResponse.json(
      { error: toClientErrorMessage(error) },
      { status: 500 }
    );
  }
}
