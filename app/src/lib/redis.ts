/**
 * Redis 客户端单例（Stage 2 引入）
 *
 * 用途：
 * - 分布式限流（`lib/rate-limit.ts` 的 RedisStore）
 * - Prompt 缓存（`lib/cache/prompt-cache.ts`）
 * - Workflow 事件 PubSub（`services/agents/workflow-engine.ts`）
 * - BullMQ 队列（`services/queue.ts`）
 *
 * 设计：
 * - 未配置 REDIS_URL → 返回 null，调用方必须自行降级到内存实现。
 * - 配置了 REDIS_URL → 懒加载 ioredis（避免 Edge runtime 打包失败）；单例复用。
 * - PubSub 的 publisher / subscriber 必须独立连接（ioredis 订阅模式会独占连接）。
 */

import type { Redis } from "ioredis";
import { createLogger } from "./logger";

const log = createLogger("lib:redis");

let sharedClient: Redis | null = null;
let subscriberClient: Redis | null = null;
let publisherClient: Redis | null = null;
let initAttempted = false;

/**
 * 返回共享的 Redis 连接（用于 GET/SET/INCR 等普通命令）。
 * 未配置 REDIS_URL 时返回 null。
 */
export async function getRedis(): Promise<Redis | null> {
  if (!process.env.REDIS_URL) {
    if (!initAttempted) {
      log.debug("REDIS_URL not set; Redis features disabled (memory fallback)");
      initAttempted = true;
    }
    return null;
  }
  if (sharedClient) return sharedClient;

  try {
    const { default: IORedis } = await import("ioredis");
    sharedClient = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    sharedClient.on("error", (err) => {
      log.error("Redis client error", { message: err.message });
    });
    sharedClient.on("connect", () => log.info("Redis connected"));
    return sharedClient;
  } catch (err) {
    log.error("Failed to init Redis client", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 返回专用于 publish 的 Redis 连接。
 * 与 subscriber 独立；publisher 可与 sharedClient 复用，这里单独导出是为了语义清晰。
 */
export async function getRedisPublisher(): Promise<Redis | null> {
  if (publisherClient) return publisherClient;
  publisherClient = await getRedis();
  return publisherClient;
}

/**
 * 返回专用于 subscribe 的 Redis 连接。
 * 每次都可能产生一个新的订阅连接；调用方负责 unsubscribe + quit。
 */
export async function createRedisSubscriber(): Promise<Redis | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    const { default: IORedis } = await import("ioredis");
    if (!subscriberClient) {
      subscriberClient = new IORedis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
      });
      subscriberClient.on("error", (err) => {
        log.error("Redis subscriber error", { message: err.message });
      });
    }
    return subscriberClient;
  } catch (err) {
    log.error("Failed to create Redis subscriber", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 生产环境强制要求 Redis。开发环境允许缺失（走内存降级）。
 */
export function isProductionWithoutRedis(): boolean {
  return process.env.NODE_ENV === "production" && !process.env.REDIS_URL;
}
