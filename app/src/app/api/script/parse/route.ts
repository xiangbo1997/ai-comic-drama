import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkTextSafety } from "@/lib/content-safety";
import { getUserLLMConfig } from "@/lib/ai-config";
import { parseScriptWithAgent } from "@/services/script";
import { prisma } from "@/lib/prisma";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { loadSeriesMemoryDigest } from "@/lib/series-memory";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:script:parse");

/**
 * 脚本解析积分成本：多轮 LLM 调用按文本长度计费。
 * 每 1000 字 1 积分，最低 2 积分（整数，避免浮点脏数据）。
 */
function scriptParseCost(text: string): number {
  return Math.max(2, Math.ceil(text.length / 1000));
}

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

    const body = await request.json();
    const text = body?.text;
    const projectId =
      typeof body?.projectId === "string" ? body.projectId : undefined;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    // 系列续集：取既定设定 digest 注入解析（校验项目归属后再查）。
    // 记忆是增强项，任何缺失都不阻断解析。
    let seriesContext: string | undefined;
    if (projectId) {
      const owned = await prisma.project.findFirst({
        where: { id: projectId, userId: session.user.id },
        select: { id: true },
      });
      if (owned) {
        seriesContext =
          (await loadSeriesMemoryDigest(projectId, "script")) ?? undefined;
      }
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
      const result = await parseScriptWithAgent(text, llmConfig, seriesContext);
      return NextResponse.json(result);
    }

    // 异步路径：建 task，立即返回 taskId
    const task = await prisma.generationTask.create({
      data: {
        type: "SCRIPT_PARSE",
        status: "PROCESSING",
        input: {
          text,
          userId: session.user.id,
          ...(projectId && { projectId }),
        },
        ...(projectId && { projectId }),
        startedAt: new Date(),
      },
    });

    // Fire-and-forget：不 await，让请求立即返回
    void runScriptParseTask(
      task.id,
      text,
      llmConfig,
      session.user.id,
      seriesContext
    ).catch((err) => {
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
  llmConfig: Parameters<typeof parseScriptWithAgent>[1],
  userId: string,
  seriesContext?: string
): Promise<void> {
  try {
    const result = await parseScriptWithAgent(text, llmConfig, seriesContext);
    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        output: JSON.parse(JSON.stringify(result)),
        completedAt: new Date(),
      },
    });
    log.info(`Script parse task ${taskId} completed`);

    // 解析成功后扣费（收口到 chargeCredits：事务 + 流水 + 幂等）。
    // 时机为成功后，失败路径不扣；以 taskId 作幂等锚点。
    // 扣费失败不阻断已交付的解析结果（产物对用户有效）。
    const cost = scriptParseCost(text);
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.creditTransaction.findFirst({
          where: { userId, sourceId: taskId, type: "GENERATE_SCRIPT" },
          select: { id: true },
        });
        if (existing) return;
        await chargeCredits(tx, {
          userId,
          amount: cost,
          type: "GENERATE_SCRIPT",
          source: "script:parse",
          sourceId: taskId,
          note: `剧本解析（${text.length}字）`,
        });
      });
    } catch (chargeErr) {
      if (chargeErr instanceof InsufficientCreditsError) {
        log.warn(
          `[script charge] task ${taskId} 余额不足（需 ${cost}，余 ${chargeErr.available}），解析已交付，本次让利`
        );
      } else {
        log.error(
          `[script charge] task ${taskId} 扣费异常（解析已交付）`,
          chargeErr
        );
      }
    }
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
