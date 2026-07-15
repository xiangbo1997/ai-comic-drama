/**
 * POST /api/assist/character-roster
 *
 * 角色画像 roster（一键 AI 制片人 · 3.1 修复）：一批角色名 + 脚本文本 → 每个角色的
 * gender/age/一句话身份。制片人向导建档前调一次，把 gender/age/description 全链路
 * 透传，修复「只传名字导致性别/年龄/人设落 null + 外貌预填瞎猜性别」。
 * 纯文本 LLM 辅助，不扣积分；同步返回。
 */

import { auth } from "@/lib/auth";
import { getUserLLMConfig } from "@/lib/ai-config";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { runStructuredDraft } from "@/services/assist-draft";
import {
  CHARACTER_ROSTER_SYSTEM,
  MAX_ROSTER_CHARACTERS,
  buildCharacterRosterPrompt,
  filterRosterByNames,
} from "@/lib/prompts";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:assist:character-roster");

const RequestSchema = z.object({
  names: z.array(z.string().trim().min(1)).min(1).max(MAX_ROSTER_CHARACTERS),
  worldview: z.string().trim().min(1, "世界观不能为空"),
  protagonist: z.string().trim().optional(),
  scenesDigest: z.string().trim().optional(),
});

// LLM 输出校验：characters 数组，每条含 name/gender/age/description。
// gender/age/description 用 catch 回落，避免 LLM 漏字段或给 null 时整单挂。
const DraftSchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string(),
        gender: z.string().catch("").default(""),
        age: z.string().catch("").default(""),
        description: z.string().catch("").default(""),
      })
    )
    .catch([])
    .default([]),
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
      system: CHARACTER_ROSTER_SYSTEM,
      userPrompt: buildCharacterRosterPrompt(parsed.data),
      schema: DraftSchema,
      config: llmConfig,
      temperature: 0.5,
      maxTokens: 1024,
    });

    // 只保留请求 names 内的条目（LLM 可能编造多余角色），并归一 gender
    const characters = filterRosterByNames(parsed.data.names, draft.characters);

    return NextResponse.json({ characters });
  } catch (error) {
    log.error("Character roster draft error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "角色画像起草失败" },
      { status: 500 }
    );
  }
}
