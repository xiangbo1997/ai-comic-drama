import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  nextEpisodeNumber,
  buildEpisodeTitle,
  pickCarryOverGenerationParams,
} from "@/lib/series";
import type { GenerationParams } from "@/types/project";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:series:[id]:episodes");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/series/[id]/episodes — 一键创建下一集
 *
 * 新集自动继承系列级设定与上一集的可延续资产：
 * 1. 集数 = 现有最大集数 +1，标题 =「系列名 第N集」
 * 2. 风格/画幅取自系列（保证十集画风统一）
 * 3. 角色阵容：复制上一集的 ProjectCharacter 关联（角色本体在用户级
 *    角色库，定妆图/音色随角色自动延续）
 * 4. 生成参数：只继承全片级参数（字幕样式/水印/BGM/采样参数），
 *    分镜键控的配置不带入（见 lib/series.ts）
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const series = await prisma.series.findFirst({
      where: { id, userId },
      include: {
        projects: {
          select: { id: true, episodeNumber: true, createdAt: true },
        },
      },
    });
    if (!series) {
      return NextResponse.json({ error: "系列不存在" }, { status: 404 });
    }

    const episode = nextEpisodeNumber(
      series.projects.map((p) => p.episodeNumber)
    );

    // 上一集 = 集数最大的一集（无编号的老数据按创建时间兜底）
    const previous = [...series.projects].sort(
      (a, b) =>
        (b.episodeNumber ?? 0) - (a.episodeNumber ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )[0];

    let carryOverParams: GenerationParams = {};
    let characterIds: string[] = [];
    if (previous) {
      const prevDetail = await prisma.project.findUnique({
        where: { id: previous.id },
        select: {
          generationParams: true,
          characters: { select: { characterId: true } },
        },
      });
      carryOverParams = pickCarryOverGenerationParams(
        prevDetail?.generationParams as GenerationParams | null
      );
      characterIds = prevDetail?.characters.map((c) => c.characterId) ?? [];
    }

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          title: buildEpisodeTitle(series.title, episode),
          style: series.style,
          aspectRatio: series.aspectRatio,
          generationParams: JSON.parse(
            JSON.stringify(carryOverParams)
          ) as Prisma.InputJsonValue,
          seriesId: series.id,
          episodeNumber: episode,
          userId,
        },
      });
      if (characterIds.length > 0) {
        await tx.projectCharacter.createMany({
          data: characterIds.map((characterId) => ({
            projectId: created.id,
            characterId,
          })),
        });
      }
      return created;
    });

    log.info(
      `Series ${series.id} new episode ${episode} → project ${project.id}` +
        `（继承角色 ${characterIds.length} 个）`
    );
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    log.error("Create episode error:", error);
    return NextResponse.json(
      { error: "Failed to create episode" },
      { status: 500 }
    );
  }
}
