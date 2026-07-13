import { auth } from "@/lib/auth";
import { getUserImageConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { generateImage } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { createLogger } from "@/lib/logger";
import { chargeCredits } from "@/lib/credits";
import {
  buildCharacterBasePrompt,
  POSE_CONSTRAINTS,
  IDENTITY_LOCK,
  SINGLE_SUBJECT,
  THREE_VIEW_NEGATIVE,
} from "@/lib/prompts/character-reference";
import { hashStringToSeed } from "@/services/generation";
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
  // 可选项目画风：命中完整画风包时给定妆照锚定画风基线（角色定妆规则 + 色彩系统）。
  // 独立角色页（无项目上下文）不传，行为不变。
  style: z.string().max(50).optional(),
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
 * 一键生成角色 正/侧/背 三视图（防生成崩坏）。
 *
 * 异步化（绕开 Cloudflare 100s 边缘超时）：串行生成 3 张图耗时可能 >100s，
 * 同步等待会被 CF 切 524。改为：建 task → 立即返回 taskId →
 * 后台串行跑 3 张 → 成功后在事务内落库 + 扣费 9 积分 → 前端轮询
 * GET /api/characters/[id]/generate-three-views/[taskId]。
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

    // 积分预检（后台成功后才真正扣费）
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

    // 建任务，立即返回 taskId（后台串行跑，绕开 CF 100s）
    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        input: { kind: "three_views", characterId: id, userId },
        cost: THREE_VIEW_COST,
        startedAt: new Date(),
      },
    });

    // 身份锚点：优先用定妆图 canonicalImageUrl，退回旧数组首图。
    // 这是角色卡主图展示的同一张，三视图以它作 i2i 起点 → 转的是「这只角色」，
    // 而非照文字重画一个新角色（三视图与主图不一致的根因）。
    const anchorImageUrl =
      character.canonicalImageUrl ?? character.referenceImages[0] ?? undefined;

    void runThreeViewsTask(
      task.id,
      id,
      userId,
      character,
      imageConfig,
      anchorImageUrl,
      style
    ).catch((err) => {
      log.error(`Background three-views task ${task.id} unhandled:`, err);
    });

    return NextResponse.json({ taskId: task.id, status: "PROCESSING" });
  } catch (error) {
    log.error("Generate three views error:", error);
    return NextResponse.json(
      { error: "生成三视图失败，请稍后重试" },
      { status: 500 }
    );
  }
}

/**
 * 后台串行生成三视图，成功后事务落库 + 扣费，结果写回 task。不抛错。
 */
async function runThreeViewsTask(
  taskId: string,
  characterId: string,
  userId: string,
  character: Parameters<typeof buildCharacterBasePrompt>[0],
  imageConfig: Awaited<ReturnType<typeof getUserImageConfig>>,
  anchorImageUrl: string | undefined,
  style: string | undefined
): Promise<void> {
  try {
    // style 命中完整画风包时，basePrompt 尾部会带上「画风基线」块（定妆规则 + 色彩系统）
    const basePrompt = buildCharacterBasePrompt(character, style);

    // 角色一致性闭环：同一角色用同一 seed；三视图**全部以主图 i2i 锚定身份**，
    // 确保转出的是「角色卡上这只角色」而非照文字重画的新角色。
    // - 有主图（anchorImageUrl）：front 也带参考图，用 IDENTITY_LOCK 指令强制保形，
    //   仅改角度/姿势；side/back 以最新落库的 front 作二次锚（同一画风继续转面）。
    // - 无主图（全新角色先生三视图）：退回原「front 文生图 → 侧/背锚 front」链路。
    const seed = hashStringToSeed(characterId);

    // 串行生成三视图（防限流）
    const results: { pose: string; url: string }[] = [];
    // 锚点铁律（根因治理）：三视图**全部**锚定同一张「原始参考图」anchorImageUrl，
    // 三张之间互不作为彼此的参考。绝不能用「刚生成的 front」去锚 side/back——
    // 否则每次重生成都在上次产物上二次漂移，画风雪崩（2D→3D）。同源同锚才一致。
    const anchor = anchorImageUrl; // 全程只读，不被覆盖
    for (const pose of POSES) {
      // Prompt 排布（权重递增，末尾最重）：
      //   构图硬约束(单角度+单主体，防九宫格) → 角色内容(basePrompt)
      //   → 身份+画风锁定(IDENTITY_LOCK 放最末，紧邻 provider 追加的
      //     FACE_ANCHOR_SUFFIX，用最高权重压住"2D→3D/换装/换光"漂移)。
      const prompt = anchor
        ? `${POSE_CONSTRAINTS[pose]}, ${SINGLE_SUBJECT}, ${basePrompt}, ${IDENTITY_LOCK}`
        : `${POSE_CONSTRAINTS[pose]}, ${SINGLE_SUBJECT}, ${basePrompt}`;
      let imageUrl = await generateImage({
        prompt,
        aspectRatio: "1:1",
        seed,
        // 三视图全部锚定同一张原始参考图（同源）；无参考图时纯文生图打底
        referenceImage: anchor,
        // 负向双向防九宫格：显式排斥拼版/多姿势/多角色
        negativePrompt: THREE_VIEW_NEGATIVE,
        config: imageConfig || undefined,
      });

      if (isStorageConfigured()) {
        try {
          imageUrl = await uploadFileFromUrl(imageUrl, {
            fileName: `character_${characterId}_${pose}_${Date.now()}.webp`,
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

    const frontUrl = results.find((r) => r.pose === "front")?.url;

    // 锚点铁律（续）：canonical 定妆锚**只认第一张、永不被三视图覆盖**。
    // 已有 anchorImageUrl（用户上传的原始参考图或历史 canonical）时，本次
    // 生成的 front 只是「衍生视图」，不得抢占 canonical——否则下次重生成会锚
    // 到本次产物，画风逐轮漂移。仅当角色此前**完全没有**身份锚时，才用本次
    // front 补一个初始锚。
    const hasAnchor = Boolean(anchorImageUrl);

    // 落库 + 扣费 + 完成任务（事务）。CharacterReferenceAsset 写入带 schema 容错。
    await prisma.$transaction(async (tx) => {
      for (const { pose, url } of results) {
        try {
          await tx.characterReferenceAsset.create({
            data: {
              characterId,
              url,
              sourceType: "ai_generated",
              // 仅在「原本无锚」且是 front 时补设 canonical；已有锚则全部非 canonical
              isCanonical: !hasAnchor && pose === "front",
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

      // 同步追加到旧 referenceImages 数组（角色卡 UI 读此字段，保持全局一致）。
      // 读最新值再追加，避免覆盖已有图片。
      const current = await tx.character.findUnique({
        where: { id: characterId },
        select: { referenceImages: true },
      });
      await tx.character.update({
        where: { id: characterId },
        data: {
          referenceImages: [
            ...(current?.referenceImages ?? []),
            ...results.map((r) => r.url),
          ],
          // canonicalImageUrl 只在「原本为空」时用本次 front 初始化；
          // 已有原始参考图时绝不覆盖（否则锚点漂移、画风雪崩）。
          ...(!hasAnchor && frontUrl ? { canonicalImageUrl: frontUrl } : {}),
        },
      });

      await chargeCredits(tx, {
        userId,
        amount: THREE_VIEW_COST,
        type: "GENERATE_REFERENCE",
        source: "character:three-views",
        sourceId: taskId,
        note: `角色三视图（${character.name}）`,
      });
      await tx.generationTask.update({
        where: { id: taskId },
        data: {
          status: "COMPLETED",
          output: { views: results, cost: THREE_VIEW_COST },
          completedAt: new Date(),
        },
      });
    });

    log.info(`Three-views task ${taskId} completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Three-views task ${taskId} failed:`, message);
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
