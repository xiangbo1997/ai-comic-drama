import { auth } from "@/lib/auth";
import { getUserImageConfig, getUserLLMConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { generateImage } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { createLogger } from "@/lib/logger";
import { chargeCredits } from "@/lib/credits";
import { buildCharacterPromptWithCustom } from "@/lib/prompts/character-reference";
import {
  normalizeCandidateCount,
  pickRecommendedIndex,
  scoreCandidate,
  type CandidateScore,
} from "@/services/generation";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:characters:generate-reference");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** 单张参考图成本（无参考图 3 / 带参考图 5），多候选按成功张数计 */
function perImageCost(hasReferenceImage: boolean): number {
  return hasReferenceImage ? 5 : 3;
}

/**
 * 为角色生成参考图（批次 2 · 1.4B：多候选抽卡 + VLM 择优）。
 *
 * 契约变更：POST 立即返回 { taskId }（异步化，绕开平台超时）；候选**不直接入库**，
 * 上传存储后放进 task.output 返回给前端，用户在候选画廊点选一张后走
 * POST /api/characters/[id]/reference-assets 提交入库。扣费按成功生成张数计
 * （用户点没点选不影响——生成即消耗了上游 API）。count=1 时仍走同一路径（前端可自动点选）。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const body = await request.json().catch(() => ({}));
    const {
      baseImage, // 上传的垫图（base64）
      customPrompt, // 用户自定义提示词
      useExistingImage, // 是否使用角色现有图片作为参考
      existingImageIndex, // 使用哪张现有图片（默认 0）
      imageConfigId,
      // 可选项目画风：命中完整画风包时给参考图锚定画风基线；独立角色页不传，行为不变
      style,
      // 多候选档位（1 / 2 / 4，缺省 1）
      count,
    } = body as {
      baseImage?: string;
      customPrompt?: string;
      useExistingImage?: boolean;
      existingImageIndex?: number;
      imageConfigId?: string;
      style?: string;
      count?: number;
    };

    const candidateCount = normalizeCandidateCount(count);

    // 验证角色归属（include appearance：让参考图 prompt 吃到结构化外貌 9 字段，
    // 与分镜出图路径对等；缺省时 buildCharacterBasePrompt 按无外貌处理，零回归）
    const character = await prisma.character.findFirst({
      where: { id, userId },
      include: { tags: { include: { tag: true } }, appearance: true },
    });

    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 前置余额校验：按 candidateCount × 单张预估
    const hasReferenceImage = Boolean(baseImage || useExistingImage);
    const cost = perImageCost(hasReferenceImage) * candidateCount;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user || user.credits < cost) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: cost,
          current: user?.credits ?? 0,
        },
        { status: 400 }
      );
    }

    // 获取用户图像 / LLM 配置（LLM 供 VLM 择优；缺失时降级不打分）
    const imageConfig = await getUserImageConfig(userId, imageConfigId);
    if (imageConfigId && !imageConfig) {
      return NextResponse.json(
        { error: "所选图片供应商不可用，请重新选择已测试成功的图像模型配置。" },
        { status: 400 }
      );
    }
    const llmConfig = await getUserLLMConfig(userId);

    // 构建提示词：自定义提示词「提权」到最前并声明最高优先级；
    // style 命中完整画风包时，身份锚点段会带上画风基线（不喧宾夺主）
    const basePromptParts = [
      buildCharacterPromptWithCustom(character, customPrompt, style),
    ];
    if (hasReferenceImage) {
      basePromptParts.push(
        "based on the reference image style, maintain similar art style and character features"
      );
    }
    const prompt = basePromptParts.join(", ");

    // 确定参考图片
    let referenceImage: string | undefined = baseImage;
    if (useExistingImage && character.referenceImages.length > 0) {
      const imageIndex = existingImageIndex ?? 0;
      if (imageIndex >= 0 && imageIndex < character.referenceImages.length) {
        const existingImageUrl = character.referenceImages[imageIndex];
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

    // 建任务，立即返回 taskId（后台生成 N 张候选，绕开平台超时）
    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        input: {
          kind: "character_reference",
          characterId: id,
          userId,
          count: candidateCount,
        },
        cost,
        startedAt: new Date(),
      },
    });

    void runReferenceCandidatesTask({
      taskId: task.id,
      characterId: id,
      characterName: character.name,
      characterDescription: character.description,
      userId,
      prompt,
      referenceImage,
      hasReferenceImage,
      candidateCount,
      imageConfig,
      llmConfig,
    }).catch((err) => {
      log.error(`Background reference candidates task ${task.id} failed:`, err);
    });

    return NextResponse.json({ taskId: task.id, status: "PROCESSING" });
  } catch (error) {
    log.error("Generate reference image error:", error);
    return NextResponse.json(
      { error: "生成角色参考图失败，请稍后重试" },
      { status: 500 }
    );
  }
}

/** 候选（回传给前端画廊；attemptId 无意义，角色域走 referenceImages 保存） */
interface ReferenceCandidate {
  imageUrl: string;
  vlmScore: number | null;
  recommended: boolean;
}

/**
 * 后台生成 N 张候选参考图，逐张上传 + VLM 择优，成功后事务扣费（按成功张数）。
 * 候选**不入库**，仅写进 task.output 供前端点选。不抛错（失败落库供轮询读取）。
 */
async function runReferenceCandidatesTask(args: {
  taskId: string;
  characterId: string;
  characterName: string;
  characterDescription: string | null;
  userId: string;
  prompt: string;
  referenceImage: string | undefined;
  hasReferenceImage: boolean;
  candidateCount: number;
  imageConfig: Awaited<ReturnType<typeof getUserImageConfig>>;
  llmConfig: Awaited<ReturnType<typeof getUserLLMConfig>>;
}): Promise<void> {
  const {
    taskId,
    characterId,
    characterName,
    characterDescription,
    userId,
    prompt,
    referenceImage,
    hasReferenceImage,
    candidateCount,
    imageConfig,
    llmConfig,
  } = args;

  try {
    // 生成一张候选：出图 → 上传存储。失败向上抛（由 allSettled 收集）。
    const generateOne = async (): Promise<string> => {
      let url = await generateImage({
        prompt,
        referenceImage,
        aspectRatio: "1:1",
        config: imageConfig || undefined,
      });
      if (isStorageConfigured()) {
        try {
          const fileName = `character_${characterId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.webp`;
          url = await uploadFileFromUrl(url, {
            fileName,
            contentType: "image/webp",
            fileType: "image",
            userId,
          });
        } catch (uploadError) {
          log.error(
            "Failed to save candidate, using external URL:",
            uploadError
          );
        }
      }
      return url;
    };

    // 并行度：串行或最多 2 并发（防限流）。count=1 即单发。
    const CONCURRENCY = candidateCount >= 4 ? 2 : 1;
    const settled: PromiseSettledResult<string>[] = [];
    for (let i = 0; i < candidateCount; i += CONCURRENCY) {
      const batch = Array.from(
        { length: Math.min(CONCURRENCY, candidateCount - i) },
        () => generateOne()
      );
      settled.push(...(await Promise.allSettled(batch)));
    }

    const urls = settled
      .filter(
        (s): s is PromiseFulfilledResult<string> => s.status === "fulfilled"
      )
      .map((s) => s.value);

    if (urls.length === 0) {
      const firstReason = settled.find(
        (s): s is PromiseRejectedResult => s.status === "rejected"
      )?.reason;
      throw firstReason instanceof Error
        ? firstReason
        : new Error("所有候选参考图生成失败");
    }

    // VLM 择优：角色维度（与角色描述的符合度、人脸质量、单主体）。降级不阻断。
    const characterDescriptions = `${characterName}: ${characterDescription ?? ""}`;
    const scores: CandidateScore[] = await Promise.all(
      urls.map((url) =>
        scoreCandidate(
          {
            imageUrl: url,
            sceneDescription: characterDescriptions,
            characterDescriptions,
            expectedEmotion: "neutral",
            expectedShotType: "character portrait, single subject, full body",
          },
          llmConfig
        )
      )
    );
    const recommendedIdx = pickRecommendedIndex(scores);

    const candidates: ReferenceCandidate[] = urls.map((url, i) => ({
      imageUrl: url,
      vlmScore: scores[i].vlmScore,
      recommended: i === recommendedIdx,
    }));

    // 扣费按成功张数 × 单张成本（事务内扣费+记流水+余额校验）
    const actualCost = perImageCost(hasReferenceImage) * urls.length;
    await prisma.$transaction(async (tx) => {
      await chargeCredits(tx, {
        userId,
        amount: actualCost,
        type: "GENERATE_REFERENCE",
        source: "characters:generate-reference",
        sourceId: taskId,
        note: `角色 ${characterName} 参考图生成（${urls.length} 张候选）`,
      });
      await tx.generationTask.update({
        where: { id: taskId },
        data: {
          status: "COMPLETED",
          output: {
            candidates,
            cost: actualCost,
          } as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          cost: actualCost,
        },
      });
    });

    log.info(`Reference candidates task ${taskId} completed`, {
      requested: candidateCount,
      success: urls.length,
      recommendedIdx,
    });
  } catch (err) {
    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : "Unknown error",
        completedAt: new Date(),
      },
    });
    log.error(`Reference candidates task ${taskId} failed:`, err);
  }
}
