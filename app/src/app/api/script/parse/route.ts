import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkTextSafety } from "@/lib/content-safety";
import { getUserLLMConfig } from "@/lib/ai-config";
import { parseScript } from "@/services/script";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:script:parse");

export async function POST(request: NextRequest) {
  try {
    // 获取当前用户
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (text.length > 10000) {
      return NextResponse.json(
        { error: "Text exceeds maximum length of 10000 characters" },
        { status: 400 }
      );
    }

    // 内容安全检查
    const safetyCheck = checkTextSafety(text);
    if (!safetyCheck.safe) {
      return NextResponse.json(
        {
          error: "内容不符合安全规范",
          reason: safetyCheck.reason,
          blockedKeywords: safetyCheck.blockedKeywords,
        },
        { status: 400 }
      );
    }

    // 获取用户的 LLM 配置
    const llmConfig = await getUserLLMConfig(session.user.id);
    if (!llmConfig) {
      return NextResponse.json(
        { error: "请先在「设置 > AI 模型配置」中配置大语言模型" },
        { status: 400 }
      );
    }

    const result = await parseScript(text, llmConfig);

    return NextResponse.json(result);
  } catch (error) {
    log.error("Script parse error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to parse script";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
