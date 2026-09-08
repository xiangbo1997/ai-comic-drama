import { auth } from "@/lib/auth";
import { getSystemConfig } from "@/lib/system-config";
import { getUserLLMConfig } from "@/lib/ai-config";
import { chatCompletion } from "@/services/ai";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:characters:generate-description");

/** 角色名长度上限：名字直接拼进 prompt，长值只会撑爆 token */
const MAX_NAME_LENGTH = 100;

/**
 * 外貌描述生成积分成本：单次 LLM 调用（maxTokens 200），定额 1 积分。
 * 输入已被 MAX_NAME_LENGTH 封顶，成本波动小，定额即可。
 */

// 根据角色信息生成外貌描述
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 在事务闭包内 TS 会丢失对 userId 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 限流：本端点每次调用都打一次 LLM，此前只有 auth() 无任何配额约束。
    // 计费：已按 GENERATE_DESCRIPTION_COST 计费（成功后扣，见下方），限流仍作并发兜底。
    const rateLimitResult = await rateLimiters.imageGeneration(
      request,
      session.user.id
    );
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    const body = await request.json();
    const { name, gender, age } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "角色名称不能为空" }, { status: 400 });
    }

    if (typeof name !== "string" || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `角色名称超过最大长度（${MAX_NAME_LENGTH} 字）` },
        { status: 400 }
      );
    }

    // 获取用户 LLM 配置
    const llmConfig = await getUserLLMConfig(session.user.id);

    // 构建提示词
    const genderText = gender === "male" ? "男" : "女";
    const ageText = age ? `${age}岁` : "年龄未知";

    const prompt = `请为以下角色生成一段简洁的外貌描述（50-100字）：
- 名称：${name}
- 性别：${genderText}
- 年龄：${ageText}

要求：
1. 描述应包含发型、面部特征、身材等
2. 风格适合动漫/小说角色
3. 语言简洁生动
4. 只输出描述文字，不要其他内容`;

    const messages = [
      {
        role: "system" as const,
        content:
          "你是一个专业的角色设计师，擅长为小说和动漫角色创作生动的外貌描述。",
      },
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    const description = await chatCompletion(messages, {
      config: llmConfig || undefined,
      temperature: 0.8,
      maxTokens: 200,
    });

    // 扣费（收口到 chargeCredits：事务 + 流水 + 余额校验）。
    // 时机为 LLM 调用成功后，失败路径不扣。本端点是一次性调用、无 task 落库，
    // 故 sourceId 用 randomUUID() 作流水唯一标识（不具幂等语义，也无需——
    // 每次 POST 都是一次独立的付费调用，天然无重放）。
    // 余额不足 → 400，与其他生成类端点的错误语义一致。
    // 单价走系统配置（后台可调）
    const GENERATE_DESCRIPTION_COST = await getSystemConfig(
      "COST_GENERATE_DESCRIPTION"
    );
    try {
      await prisma.$transaction(async (tx) => {
        await chargeCredits(tx, {
          userId,
          amount: GENERATE_DESCRIPTION_COST,
          type: "GENERATE_SCRIPT",
          source: "characters:generate-description",
          sourceId: randomUUID(),
          note: "角色外貌描述生成",
        });
      });
    } catch (chargeErr) {
      if (chargeErr instanceof InsufficientCreditsError) {
        return NextResponse.json(
          {
            error: "Insufficient credits",
            required: GENERATE_DESCRIPTION_COST,
            current: chargeErr.available,
          },
          { status: 400 }
        );
      }
      throw chargeErr;
    }

    return NextResponse.json({ description: description.trim() });
  } catch (error) {
    log.error("Generate description error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成描述失败" },
      { status: 500 }
    );
  }
}
