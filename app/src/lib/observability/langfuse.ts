/**
 * Langfuse 观测封装（Stage 2.9）
 *
 * 设计目标：
 * - 接入简单：一行 `observeLLM(async () => ...)` 包住调用即可生成 trace/span
 * - 完全可选：未配置 `LANGFUSE_PUBLIC_KEY` 时所有函数变成 no-op，不抛错
 * - 零业务耦合：不修改 chatCompletion 对外契约
 * - 成本低：lazy 初始化 + 失败静默
 *
 * 配置：
 *   LANGFUSE_PUBLIC_KEY     必填（启用观测）
 *   LANGFUSE_SECRET_KEY     必填
 *   LANGFUSE_BASE_URL       可选（默认 cloud.langfuse.com；自托管填自家 URL）
 *   LANGFUSE_FLUSH_AT       可选（默认 1；生产可调大）
 */

import type { Langfuse } from "langfuse";
import { createLogger } from "../logger";

const log = createLogger("lib:langfuse");

let client: Langfuse | null = null;
let initAttempted = false;
let disabled = false;

async function getClient(): Promise<Langfuse | null> {
  if (disabled) return null;
  if (client) return client;
  if (initAttempted) return client;

  initAttempted = true;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    disabled = true;
    log.debug("Langfuse not configured; observability disabled");
    return null;
  }

  try {
    const { Langfuse } = await import("langfuse");
    client = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL,
      flushAt: process.env.LANGFUSE_FLUSH_AT
        ? parseInt(process.env.LANGFUSE_FLUSH_AT, 10)
        : 1,
    });
    return client;
  } catch (err) {
    disabled = true;
    log.warn("Failed to init Langfuse, observability disabled", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ============ 接入 API ============

export interface TraceContext {
  name: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface GenerationInput {
  name: string;
  model?: string;
  input: unknown;
  metadata?: Record<string, unknown>;
}

export interface GenerationResult {
  output: unknown;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  level?: "DEFAULT" | "DEBUG" | "WARNING" | "ERROR";
  statusMessage?: string;
}

/**
 * 包一个 LLM 调用：自动生成 trace + generation span，记录输入/输出/耗时。
 * Langfuse 未配置时退化为直接 await fn。
 */
export async function observeLLM<T>(
  ctx: TraceContext & GenerationInput,
  fn: () => Promise<T>,
  extract?: (result: T) => Partial<GenerationResult>
): Promise<T> {
  const lf = await getClient();
  if (!lf) return fn();

  const trace = lf.trace({
    name: ctx.name,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    metadata: ctx.metadata,
    tags: ctx.tags,
  });
  const gen = trace.generation({
    name: ctx.name,
    model: ctx.model,
    input: ctx.input,
    metadata: ctx.metadata,
    startTime: new Date(),
  });

  try {
    const result = await fn();
    const extracted = extract?.(result) ?? {};
    gen.end({
      output: extracted.output ?? result,
      usage: extracted.usage,
      level: extracted.level,
      statusMessage: extracted.statusMessage,
    });
    return result;
  } catch (err) {
    gen.end({
      output: null,
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * 轻量版：只记录一次事件（不包函数），给 provider 层使用。
 */
export async function recordGeneration(args: {
  name: string;
  model?: string;
  input: unknown;
  output: unknown;
  userId?: string;
  metadata?: Record<string, unknown>;
  startTime: Date;
  endTime: Date;
  error?: string;
}): Promise<void> {
  const lf = await getClient();
  if (!lf) return;

  try {
    const trace = lf.trace({
      name: args.name,
      userId: args.userId,
      metadata: args.metadata,
    });
    trace.generation({
      name: args.name,
      model: args.model,
      input: args.input,
      output: args.error ? null : args.output,
      metadata: args.metadata,
      startTime: args.startTime,
      endTime: args.endTime,
      level: args.error ? "ERROR" : undefined,
      statusMessage: args.error,
    });
  } catch {
    // 观测层失败静默
  }
}

/**
 * 强制 flush（worker 退出前调用；API 路由不需要）
 */
export async function flushLangfuse(): Promise<void> {
  if (!client) return;
  try {
    await client.flushAsync();
  } catch {
    // ignore
  }
}
