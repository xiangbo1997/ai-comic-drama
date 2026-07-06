import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:series");

// 获取当前用户的系列列表（含集数统计，项目列表页分组用）
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const seriesList = await prisma.series.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { projects: true } } },
    });

    return NextResponse.json(
      seriesList.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        genre: s.genre,
        style: s.style,
        aspectRatio: s.aspectRatio,
        worldview: s.worldview,
        protagonist: s.protagonist,
        episodeCount: s._count.projects,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }))
    );
  } catch (error) {
    log.error("Get series list error:", error);
    return NextResponse.json(
      { error: "Failed to get series list" },
      { status: 500 }
    );
  }
}

const CreateSeriesSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  genre: z.string().trim().max(100).optional(),
  style: z.string().trim().max(50).optional(),
  aspectRatio: z.string().trim().max(20).optional(),
  worldview: z.string().trim().max(8000).optional(),
  protagonist: z.string().trim().max(2000).optional(),
  /** 可选：把一个已有独立项目收编为本系列第 1 集，并继承其风格/画幅/世界观 */
  fromProjectId: z.string().max(64).optional(),
});

// 创建系列（可选从现有项目升级：该项目成为第 1 集）
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const parsed = CreateSeriesSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求参数无效", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // 从现有项目升级：校验归属 + 未加入其他系列，并继承其设定作为系列默认
    let fromProject: {
      id: string;
      style: string;
      aspectRatio: string;
    } | null = null;
    let inheritedWorldview: string | undefined;
    let inheritedProtagonist: string | undefined;
    let inheritedGenre: string | undefined;

    if (input.fromProjectId) {
      const project = await prisma.project.findFirst({
        where: { id: input.fromProjectId, userId },
        select: { id: true, style: true, aspectRatio: true, seriesId: true },
      });
      if (!project) {
        return NextResponse.json({ error: "项目不存在" }, { status: 404 });
      }
      if (project.seriesId) {
        return NextResponse.json(
          { error: "该项目已属于其他系列" },
          { status: 400 }
        );
      }
      fromProject = project;

      // 世界观/主角/类型：未显式提供时，从该项目最新短剧脚本继承
      const latestScript = await prisma.shortDramaScript.findFirst({
        where: { projectId: project.id },
        orderBy: { updatedAt: "desc" },
        select: { worldview: true, protagonist: true, genre: true },
      });
      inheritedWorldview = latestScript?.worldview ?? undefined;
      inheritedProtagonist = latestScript?.protagonist ?? undefined;
      inheritedGenre = latestScript?.genre ?? undefined;
    }

    const series = await prisma.$transaction(async (tx) => {
      const created = await tx.series.create({
        data: {
          title: input.title,
          description: input.description || null,
          genre: input.genre || inheritedGenre || null,
          style: input.style || fromProject?.style || "anime",
          aspectRatio: input.aspectRatio || fromProject?.aspectRatio || "9:16",
          worldview: input.worldview || inheritedWorldview || null,
          protagonist: input.protagonist || inheritedProtagonist || null,
          userId,
        },
      });
      if (fromProject) {
        await tx.project.update({
          where: { id: fromProject.id },
          data: { seriesId: created.id, episodeNumber: 1 },
        });
      }
      return created;
    });

    return NextResponse.json(series, { status: 201 });
  } catch (error) {
    log.error("Create series error:", error);
    return NextResponse.json(
      { error: "Failed to create series" },
      { status: 500 }
    );
  }
}
