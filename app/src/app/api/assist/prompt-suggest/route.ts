/**
 * POST /api/assist/prompt-suggest
 *
 * 提示词 AI 建议（计划 §4 · 1.3）：基于角色/分镜上下文产出 2~3 条中文短句建议，
 * 供「生成参考图」与「分镜迭代」两处输入框做可点选 chip。
 * 纯文本 LLM 辅助，不扣积分；同步返回。
 */

import { auth } from "@/lib/auth";
import { getUserLLMConfig } from "@/lib/ai-config";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { runStructuredDraft } from "@/services/assist-draft";
import { PROMPT_SUGGEST_SYSTEM, buildPromptSuggestPrompt } from "@/lib/prompts";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:assist:prompt-suggest");

const RequestSchema = z.object({
  context: z.enum(["character_reference", "scene_iterate"]),
  character: z
    .object({
      name: z.string().trim().min(1),
      gender: z.string().trim().optional(),
      age: z.string().trim().optional(),
      description: z.string().trim().optional(),
    })
    .optional(),
  scene: z
    .object({
      description: z.string().trim().optional(),
      dialogue: z.string().trim().optional(),
      emotion: z.string().trim().optional(),
      shotType: z.string().trim().optional(),
    })
    .optional(),
  currentPrompt: z.string().trim().optional(),
});

// LLM 输出校验：2~3 条非空短句。多返回时截断到 3 条。
const DraftSchema = z.object({
  suggestions: z
    .array(z.string().trim().min(1))
    .min(1)
    .transform((arr) => arr.slice(0, 3)),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

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
      system: PROMPT_SUGGEST_SYSTEM,
      userPrompt: buildPromptSuggestPrompt(parsed.data),
      schema: DraftSchema,
      config: llmConfig,
      temperature: 0.9,
      maxTokens: 512,
    });

    return NextResponse.json(draft);
  } catch (error) {
    log.error("Prompt suggest error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提示词建议失败" },
      { status: 500 }
    );
  }
}
