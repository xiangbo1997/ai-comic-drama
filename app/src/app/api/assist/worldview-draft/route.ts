/**
 * POST /api/assist/worldview-draft
 *
 * 世界观 AI 起草（计划 §4 · 1.1）：一句话想法 → 完整世界观 + 主角 + 类型 + 片名。
 * 纯文本 LLM 辅助，不扣积分（与 generate-description 对齐）；同步返回，不走异步任务。
 */

import { auth } from "@/lib/auth";
import { getUserLLMConfig } from "@/lib/ai-config";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { runStructuredDraft } from "@/services/assist-draft";
import {
  WORLDVIEW_DRAFT_SYSTEM,
  buildWorldviewDraftPrompt,
} from "@/lib/prompts";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:assist:worldview-draft");

// 请求体校验：idea 必填，genre 可选
const RequestSchema = z.object({
  idea: z.string().trim().min(1, "请先输入一句话想法"),
  genre: z.string().trim().optional(),
  seriesContext: z.string().trim().optional(),
});

// LLM 输出校验：四字段非空
const DraftSchema = z.object({
  worldview: z.string().trim().min(1),
  protagonist: z.string().trim().min(1),
  genre: z.string().trim().min(1),
  filmTitle: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // 限流：辅助起草也是 LLM 调用，复用图像生成的每分钟 10 次预设
    const rl = await rateLimiters.imageGeneration(request, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "参数错误" },
        { status: 400 }
      );
    }

    const llmConfig = await getUserLLMConfig(userId);

    const draft = await runStructuredDraft({
      system: WORLDVIEW_DRAFT_SYSTEM,
      userPrompt: buildWorldviewDraftPrompt(parsed.data),
      schema: DraftSchema,
      config: llmConfig,
      temperature: 0.9,
      maxTokens: 1024,
    });

    return NextResponse.json(draft);
  } catch (error) {
    log.error("Worldview draft error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "世界观起草失败" },
      { status: 500 }
    );
  }
}
