/**
 * POST /api/assist/appearance-draft
 *
 * 角色外貌 10 字段 AI 预填（计划 §4 · 1.2）：name/gender/age/description → 与
 * AppearanceFormData 对齐的结构化外貌 JSON（中文，尽量落在 UI 预设内）。
 * 纯文本 LLM 辅助，不扣积分；同步返回。
 */

import { auth } from "@/lib/auth";
import { getUserLLMConfig } from "@/lib/ai-config";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { runStructuredDraft } from "@/services/assist-draft";
import {
  APPEARANCE_DRAFT_SYSTEM,
  buildAppearanceDraftPrompt,
} from "@/lib/prompts";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:assist:appearance-draft");

const RequestSchema = z.object({
  name: z.string().trim().min(1, "角色名称不能为空"),
  gender: z.string().trim().optional(),
  age: z.string().trim().optional(),
  description: z.string().trim().optional(),
});

const ClothingPresetSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim(),
});

// LLM 输出校验：10 字段结构对齐 AppearanceFormData。
// 除 clothingPresets 外均为字符串（允许空串，因为「只填空字段」在前端做，
// 服务端产出完整 10 字段即可）；LLM 若把某项漏成 null，用 catch 回落空串防整单挂。
const DraftSchema = z.object({
  hairStyle: z.string().catch("").default(""),
  hairColor: z.string().catch("").default(""),
  faceShape: z.string().catch("").default(""),
  eyeColor: z.string().catch("").default(""),
  bodyType: z.string().catch("").default(""),
  height: z.string().catch("").default(""),
  skinTone: z.string().catch("").default(""),
  accessories: z.string().catch("").default(""),
  freeText: z.string().catch("").default(""),
  clothingPresets: z.array(ClothingPresetSchema).catch([]).default([]),
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
      system: APPEARANCE_DRAFT_SYSTEM,
      userPrompt: buildAppearanceDraftPrompt(parsed.data),
      schema: DraftSchema,
      config: llmConfig,
      temperature: 0.7,
      maxTokens: 768,
    });

    return NextResponse.json(draft);
  } catch (error) {
    log.error("Appearance draft error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "外貌预填失败" },
      { status: 500 }
    );
  }
}
