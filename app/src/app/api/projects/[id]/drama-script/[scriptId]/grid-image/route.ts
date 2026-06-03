import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserImageConfig } from "@/lib/ai-config";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { generateGridImage } from "@/services/drama-script";
import { buildGridImagePrompt } from "@/lib/prompts/grid-prompt";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import type { StoryboardTableArtifact } from "@/types/drama";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:drama-script:grid-image");

interface RouteParams {
  params: Promise<{ id: string; scriptId: string }>;
}

const GRID_COST = 5; // 九宫格合成图积分成本（对齐 generate-reference 带参考图档）

const BodySchema = z.object({
  imageConfigId: z.string().max(255).optional(),
});

/**
 * POST /api/projects/[id]/drama-script/[scriptId]/grid-image
 * 由九宫格分镜表生成一张 3×3 合成图（阶段3）。扣 5 积分，走 chargeCredits 事务+流水。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id, scriptId } = await params;

    // 限流
    const rl = await rateLimiters.imageGeneration(request, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    // 归属校验 + 取分镜表
    const script = await prisma.shortDramaScript.findFirst({
      where: { id: scriptId, projectId: id, project: { userId } },
    });
    if (!script) {
      return NextResponse.json({ error: "脚本不存在" }, { status: 404 });
    }

    const table =
      script.storyboard as unknown as StoryboardTableArtifact | null;
    if (!table?.cells?.length) {
      return NextResponse.json(
        { error: "请先生成九宫格分镜表" },
        { status: 400 }
      );
    }

    // 内容安全（对合成 prompt 审核）
    const prompt = buildGridImagePrompt(table.cells, script.style);
    const safety = await contentSafetyMiddleware(prompt, "image");
    if (!safety.safe) {
      return NextResponse.json(
        { error: "内容不符合安全规范", reason: safety.reason },
        { status: 400 }
      );
    }

    // 积分预检
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user || user.credits < GRID_COST) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: GRID_COST,
          current: user?.credits ?? 0,
        },
        { status: 400 }
      );
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    const imageConfigId = parsed.success
      ? parsed.data.imageConfigId
      : undefined;
    const config = await getUserImageConfig(userId, imageConfigId);

    // 建任务
    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        input: { kind: "grid_image", scriptId },
        projectId: id,
        cost: GRID_COST,
        startedAt: new Date(),
      },
    });

    try {
      const gridImageUrl = await generateGridImage(
        table.cells,
        script.style,
        script.aspectRatio,
        userId,
        config ?? undefined
      );

      // 成功后：更新 gridImageUrl + 完成任务 + 扣费，原子事务
      await prisma.$transaction(async (tx) => {
        await tx.shortDramaScript.update({
          where: { id: scriptId },
          data: { gridImageUrl },
        });
        await tx.generationTask.update({
          where: { id: task.id },
          data: {
            status: "COMPLETED",
            output: { gridImageUrl },
            completedAt: new Date(),
          },
        });
        await chargeCredits(tx, {
          userId,
          amount: GRID_COST,
          type: "GENERATE_IMAGE",
          source: "drama:grid-image",
          sourceId: task.id,
          note: `九宫格合成图（脚本 ${scriptId}）`,
        });
      });

      return NextResponse.json({ gridImageUrl, cost: GRID_COST });
    } catch (error) {
      await prisma.generationTask
        .update({
          where: { id: task.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          },
        })
        .catch(() => {});
      if (error instanceof InsufficientCreditsError) {
        return NextResponse.json(
          { error: "积分不足", required: GRID_COST },
          { status: 400 }
        );
      }
      throw error;
    }
  } catch (error) {
    log.error("Grid image generation error:", error);
    return NextResponse.json({ error: "生成九宫格图失败" }, { status: 500 });
  }
}
