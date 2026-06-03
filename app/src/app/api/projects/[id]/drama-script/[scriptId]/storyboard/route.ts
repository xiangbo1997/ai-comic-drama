import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getUserLLMConfig } from "@/lib/ai-config";
import { generateStoryboardTable } from "@/services/drama-script";
import { prisma } from "@/lib/prisma";
import type {
  DramaScriptArtifact,
  StoryboardTableArtifact,
} from "@/types/drama";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:drama-script:storyboard");

interface RouteParams {
  params: Promise<{ id: string; scriptId: string }>;
}

/** 校验脚本归属，返回脚本（含 scriptDoc）或 null */
async function findOwnedScript(
  userId: string,
  projectId: string,
  scriptId: string
) {
  return prisma.shortDramaScript.findFirst({
    where: { id: scriptId, projectId, project: { userId } },
  });
}

/**
 * POST /api/projects/[id]/drama-script/[scriptId]/storyboard
 * 由结构化脚本生成九宫格分镜表（阶段2）。纯 LLM，不扣积分。异步返回 taskId。
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { id, scriptId } = await params;
    const script = await findOwnedScript(session.user.id, id, scriptId);
    if (!script) {
      return NextResponse.json({ error: "脚本不存在" }, { status: 404 });
    }

    const doc = script.scriptDoc as unknown as DramaScriptArtifact;
    if (!doc?.scenes?.length) {
      return NextResponse.json(
        { error: "脚本内容为空，请先生成结构化脚本" },
        { status: 400 }
      );
    }

    const llmConfig = await getUserLLMConfig(session.user.id);
    if (!llmConfig) {
      return NextResponse.json(
        { error: "请先在「设置 > AI 模型配置」中配置大语言模型" },
        { status: 400 }
      );
    }

    const task = await prisma.generationTask.create({
      data: {
        type: "SCRIPT_PARSE",
        status: "PROCESSING",
        input: { kind: "storyboard_table", scriptId, userId: session.user.id },
        projectId: id,
        startedAt: new Date(),
      },
    });

    void runStoryboardTask(task.id, scriptId, doc, llmConfig).catch((err) => {
      log.error(`Background storyboard task ${task.id} unhandled:`, err);
    });

    return NextResponse.json({ taskId: task.id, status: "PROCESSING" });
  } catch (error) {
    log.error("Storyboard POST error:", error);
    return NextResponse.json({ error: "生成分镜表失败" }, { status: 500 });
  }
}

/** 后台生成九宫格分镜表，落 ShortDramaScript.storyboard + 写回 task。不抛错。 */
async function runStoryboardTask(
  taskId: string,
  scriptId: string,
  doc: DramaScriptArtifact,
  llmConfig: Awaited<ReturnType<typeof getUserLLMConfig>>
): Promise<void> {
  try {
    const table: StoryboardTableArtifact = await generateStoryboardTable(
      doc,
      llmConfig ?? undefined
    );

    await prisma.shortDramaScript.update({
      where: { id: scriptId },
      data: { storyboard: JSON.parse(JSON.stringify(table)) },
    });

    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        output: { scriptId, ...JSON.parse(JSON.stringify(table)) },
        completedAt: new Date(),
      },
    });
    log.info(`Storyboard task ${taskId} completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Storyboard task ${taskId} failed:`, message);
    await prisma.generationTask
      .update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          error: message.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch(() => {});
  }
}

// 逐格打磨：整张表替换（前端编辑后提交完整 cells）
const PatchSchema = z.object({
  storyboard: z.object({
    cells: z
      .array(
        z.object({
          index: z.number(),
          sceneTitle: z.string(),
          shot: z.string(),
          dialogue: z.string().nullable(),
          closeup: z.string(),
          transition: z.string(),
          thumbnailUrl: z.string().optional(),
        })
      )
      .length(9),
  }),
});

/**
 * PATCH /api/projects/[id]/drama-script/[scriptId]/storyboard
 * 创作者逐格打磨分镜表（提交完整 9 格）。
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { id, scriptId } = await params;
    const script = await findOwnedScript(session.user.id, id, scriptId);
    if (!script) {
      return NextResponse.json({ error: "脚本不存在" }, { status: 404 });
    }

    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求参数无效", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await prisma.shortDramaScript.update({
      where: { id: scriptId },
      data: {
        storyboard: JSON.parse(JSON.stringify(parsed.data.storyboard)),
        version: { increment: 1 },
      },
    });

    return NextResponse.json({ script: updated });
  } catch (error) {
    log.error("Storyboard PATCH error:", error);
    return NextResponse.json({ error: "更新分镜表失败" }, { status: 500 });
  }
}
