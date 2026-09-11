import { auth } from "@/lib/auth";
import { getUserImageConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { generateImage } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { createLogger } from "@/lib/logger";
import { getSystemConfig } from "@/lib/system-config";
import { chargeCredits } from "@/lib/credits";
import {
  buildCharacterBasePrompt,
  buildCustomInstructionPrefix,
  IDENTITY_LOCK,
} from "@/lib/prompts/character-reference";
import {
  EXPRESSION_KEYS,
  EXPRESSION_FRAMING,
  EXPRESSION_NEGATIVE,
  getExpressionSpec,
  toExpressionPose,
  type ExpressionKey,
} from "@/lib/expression-sheet";
import { hashStringToSeed } from "@/services/generation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:characters:generate-expressions");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 表情图单价复用三视图的「每视角单价」：两者都是「一张角色参考图」这同一种
 * 工作量，不另立 SystemConfig 键（多一个价格键就多一处会漂的真源）。
 */
async function resolveExpressionCost(count: number): Promise<number> {
  const perImage = await getSystemConfig("COST_THREE_VIEWS_PER_VIEW");
  return perImage * count;
}

const BodySchema = z.object({
  imageConfigId: z.string().max(255).optional(),
  /** 可选项目画风：命中完整画风包时锚定画风基线，与三视图路径同源 */
  style: z.string().max(50).optional(),
  /** 用户自定义提示词：最高优先级前缀，与三视图 / 参考图路径同源 */
  customPrompt: z.string().max(2000).optional(),
  /**
   * 要生成的表情子集；缺省 = 全部 6 种。
   * 支持子集是为了「只补一张漏掉的」而不必重出整套（重出要重新扣满额积分）。
   */
  expressions: z
    .array(z.enum(EXPRESSION_KEYS))
    .min(1)
    .max(EXPRESSION_KEYS.length)
    .optional(),
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
 * POST /api/characters/[id]/generate-expressions
 *
 * 生成角色表情集（默认 6 种：平静/喜悦/愤怒/悲伤/惊讶/羞怯）。
 *
 * 漫剧 80% 是表情特写，而此前系统对表情零锚定——全靠 emotion 关键词让模型
 * 每次重画一张脸，同角色同情绪跨镜头五官画法漂移。表情集给每种情绪一张
 * 定妆级参考图，出图时按 Scene.emotion 取用。
 *
 * 异步化（与三视图同构，绕开 Cloudflare 100s 边缘超时）：串行出 6 张图必然
 * 超时，故建 task → 立即返回 taskId → 后台串行跑 → 成功后事务落库 + 扣费 →
 * 前端轮询 GET /api/characters/[id]/generate-expressions/[taskId]。
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
    const style = parsed.success ? parsed.data.style : undefined;
    const customPrompt = parsed.success ? parsed.data.customPrompt : undefined;
    const expressions: readonly ExpressionKey[] =
      (parsed.success ? parsed.data.expressions : undefined) ?? EXPRESSION_KEYS;

    // 角色归属 + 结构化外貌（让表情图 prompt 与定妆/三视图吃到同一份外貌串）
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

    // 身份锚点：表情图必须 i2i 锚定定妆照，否则画出来是「另一个人的愤怒脸」，
    // 表情集就失去了锁一致性的全部意义。无锚时直接拒绝而非降级纯文生图——
    // 纯文生图产出的 6 张脸彼此都不像，存下来只会污染后续出图的参考池。
    const anchorImageUrl =
      character.canonicalImageUrl ?? character.referenceImages[0] ?? undefined;
    if (!anchorImageUrl) {
      return NextResponse.json(
        {
          error:
            "请先为角色生成或上传定妆照，再生成表情集（表情图需以定妆照为身份锚点）。",
        },
        { status: 400 }
      );
    }

    // 积分预检（后台成功后才真正扣费）
    const cost = await resolveExpressionCost(expressions.length);
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

    const imageConfig = await getUserImageConfig(userId, imageConfigId);
    if (imageConfigId && !imageConfig) {
      return NextResponse.json(
        { error: "所选图片供应商不可用，请重新选择已测试成功的图像模型配置。" },
        { status: 400 }
      );
    }

    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        input: { kind: "expressions", characterId: id, userId },
        cost,
        startedAt: new Date(),
      },
    });

    void runExpressionsTask({
      taskId: task.id,
      characterId: id,
      userId,
      character,
      imageConfig,
      anchorImageUrl,
      style,
      customPrompt,
      expressions,
      cost,
    }).catch((err) => {
      log.error(`Background expressions task ${task.id} unhandled:`, err);
    });

    return NextResponse.json({ taskId: task.id, status: "PROCESSING" });
  } catch (error) {
    log.error("Generate expressions error:", error);
    return NextResponse.json(
      { error: "生成表情集失败，请稍后重试" },
      { status: 500 }
    );
  }
}

/**
 * 后台串行生成表情集，成功后事务落库 + 扣费，结果写回 task。不抛错。
 */
async function runExpressionsTask(args: {
  taskId: string;
  characterId: string;
  userId: string;
  character: Parameters<typeof buildCharacterBasePrompt>[0];
  imageConfig: Awaited<ReturnType<typeof getUserImageConfig>>;
  anchorImageUrl: string;
  style: string | undefined;
  customPrompt: string | undefined;
  expressions: readonly ExpressionKey[];
  /** 本次任务总价：由 POST 建任务时定价，后台沿用同一数值避免中途改价对不上 */
  cost: number;
}): Promise<void> {
  const {
    taskId,
    characterId,
    userId,
    character,
    imageConfig,
    anchorImageUrl,
    style,
    customPrompt,
    expressions,
    cost,
  } = args;

  try {
    const basePrompt = buildCharacterBasePrompt(character, style);
    const customPrefix = buildCustomInstructionPrefix(customPrompt);

    // 角色一致性 seed：与三视图 / 分镜出图同源（同一 characterId → 同一 seed），
    // 让整个角色的所有产物锚在同一种子上。
    const seed = hashStringToSeed(characterId);

    // 锚点铁律（与三视图同规）：每张表情图都锚定**同一张**原始定妆图，
    // 绝不用「刚生成的上一张表情图」去锚下一张——否则每张都在上一张的漂移上
    // 再漂移，6 张下来画风雪崩。
    const results: { key: ExpressionKey; url: string }[] = [];
    for (const key of expressions) {
      const spec = getExpressionSpec(key);
      if (!spec) continue; // zod 已校验，理论不可达；防御性跳过

      // Prompt 排布（权重递增，末尾最重）：
      //   用户自定义指令（最高优先级前置）
      //   → 构图硬约束（单表情特写，防拼版）
      //   → 表情五官描述（本次生成的核心差异项）
      //   → 角色内容（身份锚点）
      //   → 身份+画风锁定（放最末，压住 2D→3D / 换装 / 换光漂移）
      const prompt = [
        customPrefix,
        EXPRESSION_FRAMING,
        spec.prompt,
        basePrompt,
        IDENTITY_LOCK,
        // 表情图是唯一「刻意要改脸」的参考图产物，必须显式豁免 IDENTITY_LOCK 的
        // 「只改角度不改其它」语义，否则模型会照搬定妆照的原表情、6 张全一样。
        "the ONLY thing that must differ from the reference image is the facial expression described above; " +
          "keep the same face structure, hairstyle, hair color, eye color, outfit and art style",
      ]
        .filter(Boolean)
        .join(", ");

      let imageUrl = await generateImage({
        prompt,
        aspectRatio: "1:1",
        seed,
        referenceImage: anchorImageUrl,
        negativePrompt: EXPRESSION_NEGATIVE,
        config: imageConfig || undefined,
      });

      if (isStorageConfigured()) {
        try {
          imageUrl = await uploadFileFromUrl(imageUrl, {
            fileName: `character_${characterId}_expr_${key}_${Date.now()}.webp`,
            contentType: "image/webp",
            fileType: "image",
            userId,
          });
        } catch (uploadError) {
          log.error(
            `Failed to save expression ${key}, using external URL:`,
            uploadError
          );
        }
      }
      results.push({ key, url: imageUrl });
    }

    if (results.length === 0) {
      throw new Error("未生成任何表情图");
    }

    await prisma.$transaction(async (tx) => {
      for (const { key, url } of results) {
        try {
          await tx.characterReferenceAsset.create({
            data: {
              characterId,
              url,
              sourceType: "ai_generated",
              // 表情图**永不**作定妆锚：定妆锚是全身立绘语义，
              // 一张胸上特写当锚会让所有全身镜失去身体参考。
              isCanonical: false,
              pose: toExpressionPose(key),
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

      // 刻意**不**把表情图追加进 Character.referenceImages：那个数组是「通用参考图」
      // 语义，多处路径拿它的首图当身份锚 / 兜底参考（见 generate/image 路由的回退链）。
      // 塞 6 张表情特写进去会污染这些兜底路径。表情图只经 referenceAssets 的
      // expr: 命名空间消费。

      await chargeCredits(tx, {
        userId,
        amount: cost,
        type: "GENERATE_REFERENCE",
        source: "character:expressions",
        sourceId: taskId,
        note: `角色表情集（${character.name}，${results.length} 张）`,
      });
      await tx.generationTask.update({
        where: { id: taskId },
        data: {
          status: "COMPLETED",
          output: { expressions: results, cost },
          completedAt: new Date(),
        },
      });
    });

    log.info(`Expressions task ${taskId} completed`, {
      count: results.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Expressions task ${taskId} failed:`, message);
    await prisma.generationTask
      .update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          error: message.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch(() => {});
  }
}
