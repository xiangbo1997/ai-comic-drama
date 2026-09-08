import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  parseCursor,
  parsePageLimit,
  sliceCursorPage,
} from "@/types/pagination";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects");

/**
 * 获取项目列表。
 *
 * 双形状契约（向后兼容，见 types/pagination.ts）：
 *  - 不带 `limit` → 旧版全量裸数组 `ProjectListItem[]`（老调用方零回归）；
 *  - 带 `limit`   → `{ items: ProjectListItem[], nextCursor: string | null }`。
 *
 * 查询参数：`?cursor=<projectId>&limit=<1..100>&q=<标题关键词>`。
 * `q` 走服务端 `contains` 不区分大小写模糊匹配，替代此前的客户端全量过滤。
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parsePageLimit(searchParams.get("limit"));
    const cursor = parseCursor(searchParams.get("cursor"));
    const q = searchParams.get("q")?.trim();

    const where = {
      userId: session.user.id,
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    };

    // updatedAt 可能重复，叠加 id 保证游标序确定；分页时多取 1 条探测下一页
    const rows = await prisma.project.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...(limit === null
        ? {}
        : {
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          }),
      include: {
        _count: { select: { scenes: true } },
        scenes: {
          take: 1,
          orderBy: { order: "asc" },
          select: { imageUrl: true },
        },
      },
    });

    const page = limit === null ? null : sliceCursorPage(rows, limit);
    const projects = page ? page.items : rows;

    // 各项目各媒体完成数：一次 groupBy 统计所有项目，避免逐项目 N 次 count。
    // 供列表卡展示轻量管线进度点，让用户一眼看出「哪个项目就差配音」（a5 P1-6）。
    const projectIds = projects.map((p) => p.id);
    const [imgCounts, vidCounts, audCounts, speakableCounts] =
      await Promise.all([
        prisma.scene.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projectIds }, imageUrl: { not: null } },
          _count: true,
        }),
        prisma.scene.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projectIds }, videoUrl: { not: null } },
          _count: true,
        }),
        prisma.scene.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projectIds }, audioUrl: { not: null } },
          _count: true,
        }),
        prisma.scene.groupBy({
          by: ["projectId"],
          where: {
            projectId: { in: projectIds },
            OR: [{ dialogue: { not: null } }, { narration: { not: null } }],
          },
          _count: true,
        }),
      ]);
    const toMap = (rows: { projectId: string; _count: number }[]) =>
      new Map(rows.map((r) => [r.projectId, r._count]));
    const imgMap = toMap(imgCounts);
    const vidMap = toMap(vidCounts);
    const audMap = toMap(audCounts);
    const speakableMap = toMap(speakableCounts);

    const result = projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      style: p.style,
      aspectRatio: p.aspectRatio,
      seriesId: p.seriesId,
      episodeNumber: p.episodeNumber,
      scenesCount: p._count.scenes,
      // 管线各步完成数（列表卡进度点用）
      imageCount: imgMap.get(p.id) ?? 0,
      videoCount: vidMap.get(p.id) ?? 0,
      audioCount: audMap.get(p.id) ?? 0,
      speakableCount: speakableMap.get(p.id) ?? 0,
      // 缩略图：已合成的平台封面优先，否则首张有图分镜（渐进增强，老项目零回归）
      thumbnail: p.coverImageUrl || p.scenes[0]?.imageUrl || null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    // 分页形状复用同一游标（nextCursor 由未裁剪的 rows 探测得出）
    return NextResponse.json(
      page ? { items: result, nextCursor: page.nextCursor } : result
    );
  } catch (error) {
    log.error("Get projects error:", error);
    return NextResponse.json(
      { error: "Failed to get projects" },
      { status: 500 }
    );
  }
}

// 创建新项目
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, style, aspectRatio } = body;

    const project = await prisma.project.create({
      data: {
        title: title || "未命名项目",
        description: description || null,
        style: style || "anime",
        aspectRatio: aspectRatio || "9:16",
        userId: session.user.id,
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    log.error("Create project error:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
