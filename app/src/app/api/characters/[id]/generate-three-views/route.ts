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

    void runThreeViewsTask(task.id, id, userId, character, imageConfig).catch(
      (err) => {
        log.error(`Background three-views task ${task.id} unhandled:`, err);
      }
    );

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
  imageConfig: Awaited<ReturnType<typeof getUserImageConfig>>
): Promise<void> {
  try {
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

    // 落库 + 扣费 + 完成任务（事务）。CharacterReferenceAsset 写入带 schema 容错。
    await prisma.$transaction(async (tx) => {
      for (const { pose, url } of results) {
        try {
          await tx.characterReferenceAsset.create({
            data: {
              characterId,
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
