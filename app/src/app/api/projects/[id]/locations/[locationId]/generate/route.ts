/**
 * POST /api/projects/[id]/locations/[locationId]/generate
 *
 * 生成地点空景板（无人物环境锚图，计划 §5 · 2.2）。
 *
 * 异步化（对齐 three-views）：建 task → 立即返回 taskId → 后台生成 → 成功后事务内
 * 落库 imageUrl + 扣费 → 前端轮询 GET .../generate/[taskId]。
 *
 * 扣费：空景板是「一张普通图（无参考图 / 无角色一致性）」，按 app 的每图定价约定
 * 取普通图单价 1 积分（generate/image 路由 IMAGE_COST.normal=1；withRef=3 是带参考图
 * 的角色一致性生成，不适用于纯环境板）。扣费只在成功事务内发生，失败从未扣费故无需退款
 * （与 three-views 一致）。
 */

import { auth } from "@/lib/auth";
import { getUserImageConfig } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";
import { generateImage } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { createLogger } from "@/lib/logger";
import { chargeCredits } from "@/lib/credits";
import {
  buildPlatePrompt,
  buildPlateNegative,
} from "@/services/generation/location-plate";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

const log = createLogger("api:projects:locations:generate");

interface RouteParams {
  params: Promise<{ id: string; locationId: string }>;
}

// 空景板 = 一张普通图（无参考图 / 无角色一致性），按普通图单价扣 1 积分
const PLATE_COST = 1;

/** Project.aspectRatio 是自由字符串，收敛到生成端支持的枚举（默认 9:16，同项目默认）。 */
function normalizeAspectRatio(value: string): "1:1" | "9:16" | "16:9" {
  return value === "1:1" || value === "16:9" ? value : "9:16";
}

const BodySchema = z.object({
  imageConfigId: z.string().max(255).optional(),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id, locationId } = await params;

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    const imageConfigId = parsed.success
      ? parsed.data.imageConfigId
      : undefined;

    // 校验：项目归属 + 地点行属本项目
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true, style: true, aspectRatio: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const location = await prisma.projectLocation.findFirst({
      where: { id: locationId, projectId: id },
      select: { id: true, locationKey: true, description: true },
    });
    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // 积分预检（后台成功后才真正扣费）
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user || user.credits < PLATE_COST) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: PLATE_COST,
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

    // 该地点各分镜的画面描述样本（提取环境线索）
    const sceneRows = await prisma.scene.findMany({
      where: { projectId: id, locationKey: location.locationKey },
      select: { description: true },
      take: 20,
    });
    const sceneHints = sceneRows
      .map((s) => s.description)
      .filter((d): d is string => Boolean(d));

    const prompt = buildPlatePrompt({
      locationKey: location.locationKey,
      description: location.description,
      sceneHints,
      style: project.style,
    });

    // 内容安全（与其它生成端点一致；空景板 prompt 通常安全，仍走门禁）
    const safety = await contentSafetyMiddleware(prompt, "image");
    if (!safety.safe) {
      return NextResponse.json(
        { error: safety.reason || "内容不合规，无法生成" },
        { status: 400 }
      );
    }

    const negativePrompt = buildPlateNegative(project.style);

    // 建任务，立即返回 taskId
    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        input: { kind: "location_plate", locationId, projectId: id, userId },
        cost: PLATE_COST,
        startedAt: new Date(),
      },
    });

    void runPlateTask({
      taskId: task.id,
      userId,
      locationId,
      locationKey: location.locationKey,
      prompt,
      negativePrompt,
      aspectRatio: normalizeAspectRatio(project.aspectRatio),
      style: project.style,
      imageConfig,
    }).catch((err) => {
      log.error(`Background plate task ${task.id} unhandled:`, err);
    });

    return NextResponse.json({ taskId: task.id, status: "PROCESSING" });
  } catch (error) {
    log.error("Generate location plate error:", error);
    return NextResponse.json(
      { error: "生成场景锚图失败，请稍后重试" },
      { status: 500 }
    );
  }
}

/**
 * 后台生成空景板，成功后事务落库 imageUrl + 扣费；失败退款 + task FAILED。不抛错。
 */
async function runPlateTask(p: {
  taskId: string;
  userId: string;
  locationId: string;
  locationKey: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: "1:1" | "9:16" | "16:9";
  style: string;
  imageConfig: Awaited<ReturnType<typeof getUserImageConfig>>;
}): Promise<void> {
  try {
    let imageUrl = await generateImage({
      prompt: p.prompt,
      negativePrompt: p.negativePrompt,
      aspectRatio: p.aspectRatio,
      style: p.style,
      config: p.imageConfig || undefined,
    });

    if (isStorageConfigured()) {
      try {
        imageUrl = await uploadFileFromUrl(imageUrl, {
          fileName: `location_${p.locationId}_${Date.now()}.webp`,
          contentType: "image/webp",
          fileType: "image",
          userId: p.userId,
        });
      } catch (uploadError) {
        log.error("保存空景板失败，改用外链 URL:", uploadError);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectLocation.update({
        where: { id: p.locationId },
        data: { imageUrl },
      });
      await chargeCredits(tx, {
        userId: p.userId,
        amount: PLATE_COST,
        type: "GENERATE_IMAGE",
        source: "location:plate",
        sourceId: p.taskId,
        note: `场景锚图（${p.locationKey}）`,
      });
      await tx.generationTask.update({
        where: { id: p.taskId },
        data: {
          status: "COMPLETED",
          output: { imageUrl, cost: PLATE_COST },
          completedAt: new Date(),
        },
      });
    });

    log.info(`Location plate task ${p.taskId} completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Location plate task ${p.taskId} failed:`, message);
    // 扣费只在成功事务内发生（与 three-views 一致），失败路径从未扣费 → 无需退款，
    // 仅把任务置 FAILED 记录原因。
    await prisma.generationTask
      .update({
        where: { id: p.taskId },
        data: {
          status: "FAILED",
          error: message.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch(() => {});
  }
}
