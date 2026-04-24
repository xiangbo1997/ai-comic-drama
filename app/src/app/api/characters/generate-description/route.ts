import { auth } from "@/lib/auth";
import { getUserLLMConfig } from "@/lib/ai-config";
import { chatCompletion } from "@/services/ai";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:characters:generate-description");

// 根据角色信息生成外貌描述
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, gender, age } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "角色名称不能为空" },
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
        content: "你是一个专业的角色设计师，擅长为小说和动漫角色创作生动的外貌描述。",
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

    return NextResponse.json({ description: description.trim() });
  } catch (error) {
    log.error("Generate description error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成描述失败" },
      { status: 500 }
    );
  }
}
