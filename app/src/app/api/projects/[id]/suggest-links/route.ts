/**
 * /api/projects/[id]/suggest-links
 *
 * 尾帧衔接建议（计划 §5 · 2.1）：
 * - POST：计算相邻镜对的衔接建议。确定性预筛（异地对直接排除，零 LLM）后，
 *   对候选对一次 LLM 判断「同场景且动作/时间连续」，返回建议开启衔接的镜头对。
 * - PUT：批量应用——把指定分镜的 videoLinkNext 置 true（一次事务，免 N 次 PATCH）。
 *
 * 纯文本 LLM 辅助，不扣积分（与 assist 起草路由族一致，见 worldview-draft）。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserLLMConfig, getUserVideoConfig } from "@/lib/ai-config";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { chatCompletion } from "@/services/ai";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import {
  prefilterLinkCandidates,
  buildLinkSuggestPrompt,
  parseLinkSuggestOutput,
  LINK_SUGGEST_SYSTEM,
  type LinkCandidateScene,
} from "@/services/suggest-links";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:projects:[id]:suggest-links");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 解析用户当前视频模型是否支持首尾帧插值（FL）。
 * 无视频配置时返回 false（衔接开启后会静默回落普通 I2V，UI 需提示）。
 */
async function resolveFlSupported(userId: string): Promise<boolean> {
  const videoConfig = await getUserVideoConfig(userId);
  if (!videoConfig?.protocol) return false;
  return getVideoModelCapability(videoConfig.protocol, videoConfig.model)
    .supportsFirstLastFrame;
}

// POST：计算衔接建议
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    // 限流：与 assist 起草路由族一致，复用图像生成的每分钟预设
    const rl = await rateLimiters.imageGeneration(request, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const scenes = await prisma.scene.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
      select: {
        id: true,
        order: true,
        locationKey: true,
        description: true,
        actionBeat: true,
        emotion: true,
      },
    });

    const flSupported = await resolveFlSupported(userId);

    const candidates = prefilterLinkCandidates(scenes as LinkCandidateScene[]);
    // 无候选对（分镜太少 / 全是异地相邻）→ 零 LLM 调用直接返回空建议
    if (candidates.length === 0) {
      return NextResponse.json({ suggestions: [], flSupported });
    }

    const llmConfig = await getUserLLMConfig(userId);
    if (!llmConfig) {
      return NextResponse.json(
        { error: "请先在「设置 > AI 模型配置」中配置大语言模型" },
        { status: 400 }
      );
    }

    const raw = await chatCompletion(
      [
        { role: "system", content: LINK_SUGGEST_SYSTEM },
        { role: "user", content: buildLinkSuggestPrompt(candidates) },
      ],
      { config: llmConfig, temperature: 0.3, maxTokens: 1024 }
    );

    let suggestions;
    try {
      suggestions = parseLinkSuggestOutput(raw, candidates);
    } catch (parseErr) {
      log.error("衔接建议解析失败:", parseErr);
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试" },
        { status: 502 }
      );
    }

    return NextResponse.json({ suggestions, flSupported });
  } catch (error) {
    log.error("Suggest links error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "衔接建议失败" },
      { status: 500 }
    );
  }
}

// PUT 请求体：待开启衔接的分镜 ID 列表（最多 200，全部须属本项目）
const ApplySchema = z.object({
  sceneIds: z.array(z.string().min(1)).min(1).max(200),
});

// PUT：批量应用衔接（把指定分镜 videoLinkNext 置 true）
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = ApplySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "参数错误" },
        { status: 400 }
      );
    }

    // 去重后校验所有 ID 均属本项目（防越权改他人分镜）
    const sceneIds = Array.from(new Set(parsed.data.sceneIds));
    const owned = await prisma.scene.findMany({
      where: { id: { in: sceneIds }, projectId: id },
      select: { id: true },
    });
    if (owned.length !== sceneIds.length) {
      return NextResponse.json(
        { error: "存在不属于本项目的分镜" },
        { status: 400 }
      );
    }

    // 一次事务批量置 true（免 N 次 PATCH 往返）
    const result = await prisma.scene.updateMany({
      where: { id: { in: sceneIds }, projectId: id },
      data: { videoLinkNext: true },
    });

    return NextResponse.json({ updated: result.count });
  } catch (error) {
    log.error("Apply links error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "应用衔接失败" },
      { status: 500 }
    );
  }
}
