import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chronicleEpisode } from "@/services/series/chronicler";
import { parseStoryBible } from "@/types/series-bible";
import { rateLimiters } from "@/lib/rate-limit";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:series:[id]:chronicle");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** 单次请求最多归档几集（防手动刷爆 LLM） */
const MAX_EPISODES_PER_CALL = 5;

const BodySchema = z.object({
  episodeNumber: z.number().int().min(1).optional(),
});

/**
 * POST /api/series/[id]/chronicle — 手动刷新系列故事圣经。
 *
 * body.episodeNumber：只归档指定集；缺省则归档「圣经里尚未记录的所有集」
 * （按集数升序，单次最多 5 集）。归档是幂等的（已记录的集会被跳过/替换）。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // 限流：单次最多触发 5 次 LLM 归档调用，走 strict 档防刷
    const rateLimitResult = await rateLimiters.strict(request, userId);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429 }
      );
    }

    const series = await prisma.series.findFirst({
      where: { id, userId },
      select: {
        id: true,
        storyBible: true,
        projects: {
          where: { episodeNumber: { not: null } },
          orderBy: { episodeNumber: "asc" },
          select: { id: true, episodeNumber: true },
        },
      },
    });
    if (!series) {
      return NextResponse.json({ error: "系列不存在" }, { status: 404 });
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求参数无效", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const bible = parseStoryBible(series.storyBible);
    const chronicledSet = new Set(bible.episodes.map((e) => e.episodeNumber));

    // 目标集：指定集 → 该集；否则圣经缺失的集（升序，截前 5 集）
    let targets: Array<{ id: string; episodeNumber: number }>;
    if (parsed.data.episodeNumber != null) {
      const match = series.projects.find(
        (p) => p.episodeNumber === parsed.data.episodeNumber
      );
      if (!match?.episodeNumber) {
        return NextResponse.json({ error: "该集不存在" }, { status: 404 });
      }
      targets = [{ id: match.id, episodeNumber: match.episodeNumber }];
    } else {
      targets = series.projects
        .filter(
          (p): p is { id: string; episodeNumber: number } =>
            p.episodeNumber != null && !chronicledSet.has(p.episodeNumber)
        )
        .slice(0, MAX_EPISODES_PER_CALL);
    }

    let updated = false;
    for (const t of targets) {
      const result = await chronicleEpisode({
        seriesId: series.id,
        projectId: t.id,
        episodeNumber: t.episodeNumber,
        userId,
      });
      if (result) updated = true;
    }

    // 重新读取最新圣经，返回摘要
    const fresh = await prisma.series.findUnique({
      where: { id: series.id },
      select: { storyBible: true },
    });
    const finalBible = parseStoryBible(fresh?.storyBible);

    return NextResponse.json({
      updated,
      chronicledEpisodes: targets.map((t) => t.episodeNumber),
      summary: {
        theme: finalBible.theme ?? null,
        episodeCount: finalBible.episodes.length,
        openThreads: finalBible.threads.filter((t) => t.status === "open")
          .length,
        characterCount: finalBible.characters.length,
      },
    });
  } catch (error) {
    log.error("Chronicle series error:", error);
    return NextResponse.json({ error: "刷新系列记忆失败" }, { status: 500 });
  }
}
