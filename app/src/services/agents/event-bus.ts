/**
 * Workflow 事件总线（Stage 3.3 拆分）
 *
 * 原先在 workflow-engine.ts 里混合了事件分发逻辑 + 执行逻辑，导致单文件 700+ 行。
 * 拆出后：
 * - `subscribeWorkflowEvents(runId, listener)` 对外：前端 SSE 端点订阅用
 * - `emitEvent(event)` 对内：agent 层通过 ctx.emit() 最终调到这里
 *
 * 双模式：
 * - 内存：进程内 Map<runId, Set<Listener>>；开发/单实例下足够
 * - Redis PubSub：Stage 2.4 引入；多实例部署下事件跨进程送达
 * - 两者同时工作：当前进程的 listener 走内存，其他进程 listener 由 Redis 广播
 */

import type { WorkflowEvent } from "./types";
import { getRedisPublisher, createRedisSubscriber } from "@/lib/redis";

type EventListener = (event: WorkflowEvent) => void;

/** 内存订阅表（Redis 不可用时的降级） */
const memoryListeners = new Map<string, Set<EventListener>>();

/** 每个 workflowRunId 的单调递增序号（进程内） */
const seqCounters = new Map<string, number>();

function nextSeq(workflowRunId: string): number {
  const current = seqCounters.get(workflowRunId) ?? 0;
  const next = current + 1;
  seqCounters.set(workflowRunId, next);
  return next;
}

function channelFor(workflowRunId: string): string {
  return `workflow:events:${workflowRunId}`;
}

/**
 * 订阅 workflow 事件。
 * 返回退订函数。
 */
export function subscribeWorkflowEvents(
  workflowRunId: string,
  listener: EventListener
): () => void {
  // 永远先挂内存 listener（即使走 Redis 也保持兼容）
  if (!memoryListeners.has(workflowRunId)) {
    memoryListeners.set(workflowRunId, new Set());
  }
  memoryListeners.get(workflowRunId)!.add(listener);

  // 若 Redis 可用，额外订阅 PubSub
  let redisCleanup: (() => void) | null = null;
  if (process.env.REDIS_URL) {
    void subscribeViaRedis(workflowRunId, listener).then((c) => {
      redisCleanup = c;
    });
  }

  return () => {
    memoryListeners.get(workflowRunId)?.delete(listener);
    redisCleanup?.();
  };
}

async function subscribeViaRedis(
  workflowRunId: string,
  listener: EventListener
): Promise<() => void> {
  const sub = await createRedisSubscriber();
  if (!sub) return () => {};
  const channel = channelFor(workflowRunId);
  const handler = (ch: string, payload: string): void => {
    if (ch !== channel) return;
    try {
      const event = JSON.parse(payload, dateReviver) as WorkflowEvent;
      listener(event);
    } catch {
      // 解析失败忽略
    }
  };
  await sub.subscribe(channel);
  sub.on("message", handler);
  return () => {
    sub.off("message", handler);
    void sub.unsubscribe(channel);
  };
}

function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

export function emitEvent(event: WorkflowEvent): void {
  // 附加序号，便于客户端去重/排序（Redis PubSub 不保证顺序）
  const seq = nextSeq(event.workflowRunId);
  const enriched: WorkflowEvent & { seq: number } = { ...event, seq };

  // 内存分发
  const listeners = memoryListeners.get(event.workflowRunId);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(enriched);
      } catch {
        // 忽略 listener 错误
      }
    }
  }

  // Redis 广播（跨进程）
  if (process.env.REDIS_URL) {
    void publishToRedis(event.workflowRunId, enriched);
  }
}

async function publishToRedis(
  workflowRunId: string,
  event: WorkflowEvent
): Promise<void> {
  try {
    const pub = await getRedisPublisher();
    if (!pub) return;
    await pub.publish(channelFor(workflowRunId), JSON.stringify(event));
  } catch {
    // 发布失败不影响生成流程；内存分发已执行
  }
}
