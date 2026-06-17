import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserLLMConfig } from "@/lib/ai-config";
import { NextRequest, NextResponse } from "next/server";
import type { Scene } from "@prisma/client";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { transcribeScenes, type TranscribeScene } from "@/services/transcribe";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:transcribe");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 智能字幕：从项目各分镜的配音音频识别生成带时间轴的字幕。
 *
 * 复用用户 LLM 配置的 baseUrl/apiKey 调 OpenAI 兼容 /audio/transcriptions。
 * 成片时间轴与导出侧一致：分镜起点按「有效时长」（duration / speed）累计。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // 限流（复用音频生成限流桶，识别同属重型外部调用）
    const rateLimitResult = await rateLimiters.audioGeneration(request, userId);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { model, language } = body as {
      model?: string;
      language?: string;
    };

    // 取项目分镜（含配音与时长，按 order 排序）
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: {
        id: true,
        generationParams: true,
        scenes: { orderBy: { order: "asc" } },
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 解析分镜变速配置（与导出侧一致）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const genParams = (project.generationParams as Record<string, any>) ?? {};
    const sceneEffects: Array<{ sceneId: string; speed?: number }> =
      Array.isArray(genParams.sceneEffects) ? genParams.sceneEffects : [];
    const speedOf = (sceneId: string): number => {
      const e = sceneEffects.find((s) => s.sceneId === sceneId);
      const raw = e?.speed;
      return raw != null && !isNaN(Number(raw))
        ? Math.max(0.25, Number(raw))
        : 1;
    };

    // 仅识别有配音的分镜；起点按有效时长累计
    // sceneStart 记录每个分镜成片起点，用于把扁平字幕聚合回各分镜
    let cursor = 0;
    const transcribeScenesInput: TranscribeScene[] = [];
    const sceneOrder: Array<{ id: string; start: number; end: number }> = [];
    for (const scene of project.scenes as Scene[]) {
      const speed = speedOf(scene.id);
      const effDuration = scene.duration / speed;
      if (scene.audioUrl) {
        transcribeScenesInput.push({
          id: scene.id,
          audioUrl: scene.audioUrl,
          start: cursor,
          speed,
        });
      }
      sceneOrder.push({
        id: scene.id,
        start: cursor,
        end: cursor + effDuration,
      });
      cursor += effDuration;
    }

    if (transcribeScenesInput.length === 0) {
      return NextResponse.json(
        { error: "没有可识别的配音，请先为分镜生成配音" },
        { status: 400 }
      );
    }

    // 复用 LLM 配置（OpenAI 兼容站通常同 key 提供 transcriptions）
    const config = await getUserLLMConfig(userId);
    if (!config || !config.baseUrl || !config.apiKey) {
      return NextResponse.json(
        { error: "未配置可用的 AI 接口，请先在「设置」中配置 LLM" },
        { status: 400 }
      );
    }

    const subtitles = await transcribeScenes(transcribeScenesInput, config, {
      model,
      language,
    });

    if (subtitles.length === 0) {
      return NextResponse.json({
        subtitles: [],
        dialogues: {},
        message: "未识别到有效语音（配音可能无人声）",
      });
    }

    // 按分镜聚合：落在某分镜时间窗内的字幕文本合并为该分镜 dialogue
    // （我们的字幕直接取自 scene.dialogue，识别结果回填该字段即可生效）
    const dialogues: Record<string, string> = {};
    for (const sub of subtitles) {
      const mid = (sub.start + sub.end) / 2;
      const owner = sceneOrder.find((s) => mid >= s.start && mid < s.end);
      if (!owner) continue;
      dialogues[owner.id] = dialogues[owner.id]
        ? `${dialogues[owner.id]} ${sub.text}`
        : sub.text;
    }

    return NextResponse.json({ subtitles, dialogues });
  } catch (error) {
    log.error("Transcribe error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "语音识别失败",
      },
      { status: 500 }
    );
  }
}
