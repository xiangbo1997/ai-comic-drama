import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkTextSafety } from "@/lib/content-safety";
import { getUserLLMConfig } from "@/lib/ai-config";
import { parseScriptWithAgent } from "@/services/script";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:script:parse");

/**
 * Hotfix2 方案 B (2026-05-21)：剧本解析异步化
 *
 * 旧行为：POST 同步等待 LLM 30-120 秒返回 → Cloudflare 100s 边缘超时把用户切 524
 * 新行为：
 *   1) POST 立即入 GenerationTask（type=SCRIPT_PARSE, status=PENDING）
 *   2) 启动后台 Promise 执行 parseScriptWithAgent（不 await，立即响应）
 *   3) 返回 { taskId }，让前端去轮询 GET /api/script/parse/[id]
 *
 * 为什么 fire-and-forget 安全：
 *   本项目跑在 systemd 长进程，不是 serverless lambda。
 *   Web 进程返回响应后不会被冻结回收，后台 Promise 能持续到完成。
 *
 * 老路径兼容：客户端如果想保持同步语义，可以传 `sync=true` query 参数
 *   （编辑器升级后不再使用，仅为向后兼容/调试）。
 */
export async function POST(request: NextRequest) {
  try {
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

    const llmConfig = await getUserLLMConfig(session.user.id);
    if (!llmConfig) {
      return NextResponse.json(
        { error: "请先在「设置 > AI 模型配置」中配置大语言模型" },
        { status: 400 }
      );
    }

    // 兼容：?sync=true 走旧同步路径（仅留作调试或紧急回退用）
    const url = new URL(request.url);
    if (url.searchParams.get("sync") === "true") {
      const result = await parseScriptWithAgent(text, llmConfig);
      return NextResponse.json(result);
    }

    // 异步路径：建 task，立即返回 taskId
    const task = await prisma.generationTask.create({
      data: {
        type: "SCRIPT_PARSE",
        status: "PROCESSING",
        input: { text, userId: session.user.id },
        startedAt: new Date(),
      },
    });

    // Fire-and-forget：不 await，让请求立即返回
    void runScriptParseTask(task.id, text, llmConfig).catch((err) => {
      // 这里只 catch 防止 unhandled rejection；任务内部已经把错误写入 DB
      log.error(`Background task ${task.id} unhandled rejection:`, err);
    });

    return NextResponse.json({ taskId: task.id, status: "PROCESSING" });
  } catch (error) {
    log.error("Script parse POST error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to parse script";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * 后台跑剧本解析，结果写回 GenerationTask。
 * 不抛错（除非 prisma 自身挂掉），所有错误都进 task.error 字段。
 */
async function runScriptParseTask(
  taskId: string,
  text: string,
  llmConfig: Parameters<typeof parseScriptWithAgent>[1]
): Promise<void> {
  try {
    const result = await parseScriptWithAgent(text, llmConfig);
    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        output: JSON.parse(JSON.stringify(result)),
        completedAt: new Date(),
      },
    });
    log.info(`Script parse task ${taskId} completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Script parse task ${taskId} failed:`, message);
    await prisma.generationTask
      .update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          error: message.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch((updateErr) => {
        // DB 写失败兜底：仅日志，不再抛
        log.error(`Failed to mark task ${taskId} FAILED in DB:`, updateErr);
      });
  }
}
