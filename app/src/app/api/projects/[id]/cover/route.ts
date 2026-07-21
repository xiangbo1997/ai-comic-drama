/**
 * POST /api/projects/[id]/cover
 *
 * 平台竖屏封面确定性合成（红果/抖音审核链条覆盖封面）：已有图（分镜图 / 主角
 * 定妆图）做底 + 中文大字剧名，产出 1080×1920 竖屏封面并落库到 Project.coverImageUrl。
 * 零 AI 成本 → 免费功能，不扣积分。
 *
 * 安全四件套（对齐生成类端点惯例）：
 * - session 校验 + 项目归属；
 * - zod 入参（sourceImageUrl? / title? / subtitle?，长度上限）；
 * - title/subtitle 过 content-safety（对齐平台封面标题审核，block → 400）；
 * - rateLimiters.export（与导出同档，封面合成也是每次一记 ffmpeg，按小时限流）。
 *
 * 底图不接受任意 URL：sourceImageUrl 必须命中「本项目分镜 imageUrl ∪ 关联角色
 * 定妆图」白名单（resolveCoverSource 内校验），杜绝 SSRF。缺省自动解析主角定妆图。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { resolveCoverSource } from "@/lib/cover";
import { generateProjectCover } from "@/services/cover";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:projects:[id]:cover");

// 封面合成走 ffmpeg（下载底图 + 烧字），比普通请求耗时；声明 maxDuration 兜底。
export const maxDuration = 120;

const RequestSchema = z.object({
  // 底图 URL（白名单校验在 resolveCoverSource；这里仅长度上限防滥用）
  sourceImageUrl: z.string().trim().max(2048).optional(),
  // 剧名主字（缺省用项目名）；封面是标语，钳 40 字上限
  title: z.string().trim().max(40).optional(),
  // 副题（缺省系列集数「第 N 集」）；钳 30 字上限
  subtitle: z.string().trim().max(30).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // 限流（与导出同档：每小时 10 次）
    const rl = await rateLimiters.export(request, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    // 入参校验
    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "参数不合法", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { sourceImageUrl, title, subtitle } = parsed.data;

    // 内容安全：封面标题/副题对齐平台封面标题审核（无低俗）。
    // 逐条检查用户显式传入的文案；命中 block → 400 给出原因。
    for (const text of [title, subtitle]) {
      if (text && text.length > 0) {
        const check = await contentSafetyMiddleware(text, "text");
        if (!check.safe) {
          return NextResponse.json(
            {
              error: `封面文字未通过内容审核：${check.reason ?? "包含不允许的内容"}`,
              blockedKeywords: check.blockedKeywords,
            },
            { status: 400 }
          );
        }
      }
    }

    // 拉项目：标题 / 系列集数（副题缺省）+ 分镜图 + 关联角色定妆图（白名单来源）
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        episodeNumber: true,
        scenes: {
          orderBy: { order: "asc" },
          select: { imageUrl: true },
        },
        characters: {
          select: {
            character: { select: { canonicalImageUrl: true } },
          },
        },
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 白名单来源集合
    const sceneImageUrls = project.scenes
      .map((s) => s.imageUrl)
      .filter((u): u is string => !!u);
    const characterCanonicalUrls = project.characters
      .map((c) => c.character.canonicalImageUrl)
      .filter((u): u is string => !!u);

    // 解析底图（白名单校验 + 缺省主角定妆图优先）
    const sourceUrl = resolveCoverSource({
      requestedUrl: sourceImageUrl,
      characterCanonicalUrls,
      sceneImageUrls,
    });
    if (!sourceUrl) {
      // 请求了白名单外 URL，或全片无图可做底
      const reason =
        sourceImageUrl && sourceImageUrl.length > 0
          ? "指定的底图不属于本项目，请从分镜图或角色定妆图中选择"
          : "本项目暂无可用底图，请先生成分镜图或角色定妆图";
      return NextResponse.json({ error: reason }, { status: 400 });
    }

    // 合成封面（ffmpeg 单帧 + 烧字 → 上传）
    let coverImageUrl: string;
    try {
      coverImageUrl = await generateProjectCover({
        projectId: project.id,
        userId,
        sourceUrl,
        text: {
          projectName: project.title,
          episodeNumber: project.episodeNumber,
          title,
          subtitle,
        },
      });
    } catch (err) {
      log.error(`封面合成失败 (project=${id}):`, err);
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "封面合成失败，请稍后重试",
        },
        { status: 500 }
      );
    }

    // 落库（免费功能，不扣积分）
    await prisma.project.update({
      where: { id },
      data: { coverImageUrl },
    });

    return NextResponse.json({ coverImageUrl });
  } catch (error) {
    log.error("Cover generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate cover" },
      { status: 500 }
    );
  }
}
