/**
 * Workflow SSE — 实时事件推送
 * GET /api/workflow/[id]/events
 *
 * Stage 2.5：
 * - `subscribeWorkflowEvents` 已支持 Redis PubSub，本端点对多进程部署透明
 * - 超时从固定 10 分钟改为按 workflow 预期最长时长设定（45 分钟足以覆盖 7 步 + 视频生成）
 * - 断开时确保 unsubscribe 与 Redis 订阅清理
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { subscribeWorkflowEvents } from "@/services/agents/workflow-engine";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:workflow:sse");

/** Workflow 最大存活时间：45 分钟覆盖 "分镜+角色+图像(N)+视频(N)+音频(N)+导出" */
const MAX_STREAM_LIFETIME_MS = 45 * 60 * 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  // 验证归属
  const run = await prisma.workflowRun.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!run) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      // 发送初始连接确认
      safeEnqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "connected", workflowRunId: id })}\n\n`
        )
      );

      // 订阅 workflow 事件（底层按环境自动选 Redis PubSub 或内存）
      const unsubscribe = subscribeWorkflowEvents(id, (event) => {
        const data = JSON.stringify(event);
        const ok = safeEnqueue(encoder.encode(`data: ${data}\n\n`));
        if (!ok) return;

        // workflow 结束时延迟关闭（给客户端时间消费最后事件）
        if (
          event.type === "workflow:completed" ||
          event.type === "workflow:failed"
        ) {
          setTimeout(() => cleanup(), 500);
        }
      });

      // 心跳（每 30 秒）
      const heartbeat = setInterval(() => {
        if (!safeEnqueue(encoder.encode(": heartbeat\n\n"))) {
          clearInterval(heartbeat);
        }
      }, 30000);

      // 超时关闭
      const timeout = setTimeout(() => {
        log.info(`SSE stream timeout after ${MAX_STREAM_LIFETIME_MS / 1000}s`, {
          workflowRunId: id,
        });
        cleanup();
      }, MAX_STREAM_LIFETIME_MS);

      // 客户端断开（Next.js 16 透传 AbortSignal）
      request.signal.addEventListener("abort", () => {
        log.info(`SSE aborted by client for workflow ${id}`);
        cleanup();
      });

      function cleanup(): void {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(timeout);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 流可能已关闭
        }
      }
    },
    cancel() {
      closed = true;
      log.info(`SSE client disconnected for workflow ${id}`);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Nginx 反代时禁用缓冲
    },
  });
}
