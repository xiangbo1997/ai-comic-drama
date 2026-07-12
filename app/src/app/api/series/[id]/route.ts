import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseStoryBible } from "@/types/series-bible";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:series:[id]");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取系列详情（含各集轻量信息）
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const series = await prisma.series.findFirst({
      where: { id, userId: session.user.id },
      include: {
        projects: {
          orderBy: { episodeNumber: "asc" },
          select: {
            id: true,
            title: true,
            episodeNumber: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!series) {
      return NextResponse.json({ error: "系列不存在" }, { status: 404 });
    }

    return NextResponse.json(series);
  } catch (error) {
    log.error("Get series error:", error);
    return NextResponse.json(
      { error: "Failed to get series" },
      { status: 500 }
    );
  }
}

const UpdateSeriesSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  genre: z.string().trim().max(100).nullable().optional(),
  style: z.string().trim().max(50).optional(),
  aspectRatio: z.string().trim().max(20).optional(),
  worldview: z.string().trim().max(8000).nullable().optional(),
  protagonist: z.string().trim().max(2000).nullable().optional(),
  // 高级用户手动编辑故事圣经：任意 JSON，写入前经 parseStoryBible 规整（坏字段降级）
  storyBible: z.unknown().optional(),
});

// 更新系列设定（世界观/主角/风格等；不回写已有各集，只影响后续新集）
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.series.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "系列不存在" }, { status: 404 });
    }

    const parsed = UpdateSeriesSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求参数无效", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const series = await prisma.series.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.genre !== undefined && { genre: input.genre }),
        ...(input.style !== undefined && { style: input.style }),
        ...(input.aspectRatio !== undefined && {
          aspectRatio: input.aspectRatio,
        }),
        ...(input.worldview !== undefined && { worldview: input.worldview }),
        ...(input.protagonist !== undefined && {
          protagonist: input.protagonist,
        }),
        ...(input.storyBible !== undefined && {
          storyBible: JSON.parse(
            JSON.stringify(parseStoryBible(input.storyBible))
          ) as Prisma.InputJsonValue,
        }),
      },
    });

    return NextResponse.json(series);
  } catch (error) {
    log.error("Update series error:", error);
    return NextResponse.json(
      { error: "Failed to update series" },
      { status: 500 }
    );
  }
}

// 解散系列：只删系列容器，各集因 onDelete: SetNull 降级为独立项目，
// 分镜/媒体/角色关联全部保留（与「删项目」的销毁语义刻意区分）
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.series.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "系列不存在" }, { status: 404 });
    }

    // episodeNumber 一并清掉：脱离系列后集数无意义，避免残留脏数据
    await prisma.$transaction([
      prisma.project.updateMany({
        where: { seriesId: id },
        data: { episodeNumber: null },
      }),
      prisma.series.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete series error:", error);
    return NextResponse.json(
      { error: "Failed to delete series" },
      { status: 500 }
    );
  }
}
