/**
 * 场景分析 API
 * 使用 LLM 分析场景描述和对话，提取角色动作、表情、互动等信息
 */

import { auth } from "@/lib/auth";
import { getUserLLMConfig } from "@/lib/ai-config";
import { chatCompletion } from "@/services/ai";
import {
  AnalyzeSceneRequest,
  SceneAnalysis,
  buildSceneAnalysisPrompt,
  parseSceneAnalysisResponse,
} from "@/lib/prompt-builder";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:generate:analyze-scene");

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: AnalyzeSceneRequest = await request.json();
    const { sceneDescription, dialogue, characters, emotion, shotType } = body;

    if (!sceneDescription) {
      return NextResponse.json(
        { error: "Scene description is required" },
        { status: 400 }
      );
    }

    // 获取用户的 LLM 配置
    const llmConfig = await getUserLLMConfig(session.user.id);

    // 构建分析 prompt
    const analysisPrompt = buildSceneAnalysisPrompt({
      sceneDescription,
      dialogue,
      characters: characters || [],
      emotion,
      shotType,
    });

    // 调用 LLM 进行分析
    const response = await chatCompletion(
      [
        {
          role: "system",
          content:
            "你是一个专业的分镜师和图像生成专家。你的任务是分析场景描述，提取用于图像生成的关键信息。请始终以 JSON 格式输出结果。",
        },
        {
          role: "user",
          content: analysisPrompt,
        },
      ],
      {
        config: llmConfig || undefined,
        temperature: 0.3, // 使用较低温度以获得更一致的结果
        maxTokens: 1024,
      }
    );

    // 解析响应
    const analysis: SceneAnalysis = parseSceneAnalysisResponse(response);

    return NextResponse.json(analysis);
  } catch (error) {
    log.error("Scene analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze scene" },
      { status: 500 }
    );
  }
}
