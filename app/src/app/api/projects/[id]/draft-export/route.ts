/**
 * POST /api/projects/[id]/draft-export
 *
 * 把项目组装成剪映（JianYing）/ CapCut 草稿文件夹并打 zip（draft_content.json +
 * draft_meta_info.json + material/ 全部素材 + 使用说明.txt），用户解压到剪映草稿目录
 * 即可打开继续精修。免费功能，不扣积分；zip 即时返回，不落库（零 schema 变更）。
 *
 * 安全（对齐导出/封面端点惯例）：
 * - session 校验 + 项目归属；
 * - rateLimiters.export（与导出同档，草稿打包也是每次一记下载 + ffmpeg 探测，按小时限流）；
 * - 素材下载在 services/jianying-draft 内走 safeDownload（钉 IP 防 SSRF）。
 *
 * 时间轴映射见 services/jianying-draft（逐镜视频/图片 + 配音 + 全片 BGM + 逐句字幕）。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { assembleJianyingDraft } from "@/services/jianying-draft";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:projects:[id]:draft-export");

// 草稿打包需下载全部素材 + ffprobe 探测，比普通请求耗时；声明 maxDuration 兜底
//（对齐 export/route.ts 模式）。
export const maxDuration = 300;

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

    // 限流（与导出同档：每小时 N 次）
    const rl = await rateLimiters.export(request, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    // 项目 + 分镜（含 generationParams 以读取 BGM 配置）；校验归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        aspectRatio: true,
        generationParams: true,
        scenes: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            order: true,
            duration: true,
            imageUrl: true,
            videoUrl: true,
            audioUrl: true,
            dialogue: true,
            narration: true,
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 无可用素材（零「有图/有视频」分镜）→ 400 可读错误
    const hasUsable = project.scenes.some((s) => s.videoUrl || s.imageUrl);
    if (!hasUsable) {
      return NextResponse.json(
        { error: "没有可导出的素材，请先生成分镜图或视频" },
        { status: 400 }
      );
    }

    // BGM 配置（generationParams.backgroundMusic，与导出端读法一致）
    const genParams =
      (project.generationParams as Record<string, unknown> | null) ?? {};
    const rawBgm = genParams.backgroundMusic;
    const bgm =
      rawBgm && typeof rawBgm === "object"
        ? (rawBgm as { enabled?: boolean; url?: string; volume?: number })
        : undefined;

    const result = await assembleJianyingDraft({
      projectId: project.id,
      userId,
      projectTitle: project.title,
      aspectRatio: project.aspectRatio,
      scenes: project.scenes,
      bgm,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("剪映草稿导出失败:", error);
    // 组装层的可读错误（如「没有可导出的素材」）透传给用户
    const message =
      error instanceof Error && error.message
        ? error.message
        : "剪映草稿导出失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
