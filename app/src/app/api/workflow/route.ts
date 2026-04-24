/**
 * Workflow API — 启动新 workflow / 获取 workflow 列表
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startWorkflow } from "@/services/agents/workflow-engine";
import {
  getUserLLMConfig,
  getUserImageConfig,
  getUserVideoConfig,
  getUserTTSConfig,
} from "@/lib/ai-config";
import { createLogger } from "@/lib/logger";
import type { WorkflowConfig } from "@/services/agents/types";

const log = createLogger("api:workflow");

const StartWorkflowSchema = z.object({
  projectId: z.string().min(1),
  text: z.string().min(10, "文本内容至少 10 个字符"),
  mode: z.enum(["auto", "step_by_step"]).default("auto"),
  maxImageReflectionRounds: z.number().min(0).max(5).default(2),
  style: z.string().default("anime"),
});

/** POST /api/workflow — 启动新 workflow */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = StartWorkflowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 }
      );
    }

    const { projectId, text, mode, maxImageReflectionRounds, style } =
      parsed.data;

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    // 获取用户 AI 配置
    const [llm, image, video, tts] = await Promise.all([
      getUserLLMConfig(session.user.id),
      getUserImageConfig(session.user.id),
      getUserVideoConfig(session.user.id),
      getUserTTSConfig(session.user.id),
    ]);

    if (!llm) {
      return NextResponse.json(
        { error: "请先配置 LLM 服务（设置 → AI 模型）" },
        { status: 400 }
      );
    }

    // Stage 1.10：从 Project.generationParams 读用户可调参数，注入到 WorkflowConfig。
    // 缺失或非对象时回落到 {}，保持老项目兼容。
    const rawGenParams = (project as unknown as { generationParams?: unknown })
      .generationParams;
    const generationParams =
      rawGenParams && typeof rawGenParams === "object"
        ? (rawGenParams as WorkflowConfig["generationParams"])
        : undefined;

    const config: WorkflowConfig = {
      llm: llm ?? undefined,
      image: image ?? undefined,
      video: video ?? undefined,
      tts: tts ?? undefined,
      mode,
      maxImageReflectionRounds,
      style,
      generationParams,
    };

    const workflowRunId = await startWorkflow(
      projectId,
      session.user.id,
      text,
      config
    );

    return NextResponse.json({ id: workflowRunId }, { status: 201 });
  } catch (error) {
    log.error("Start workflow error:", error);
    return NextResponse.json({ error: "启动 workflow 失败" }, { status: 500 });
  }
}

/** GET /api/workflow — 获取当前用户的 workflow 列表 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const runs = await prisma.workflowRun.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        projectId: true,
        status: true,
        currentStep: true,
        error: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json(runs);
  } catch (error) {
    log.error("List workflows error:", error);
    return NextResponse.json(
      { error: "获取 workflow 列表失败" },
      { status: 500 }
    );
  }
}
