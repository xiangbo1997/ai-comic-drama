/**
 * API 限流中间件
 * 支持 Redis（生产）和内存（开发）存储
 * 采用滑动窗口算法
 *
 * Stage 2.8：启用真正的 RedisStore（基于 ioredis）。
 * 按 env 自动选择：REDIS_URL 存在 → Redis；否则 → Memory（进程独立）。
 */

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "./redis";
import { createLogger } from "./logger";

const log = createLogger("lib:rate-limit");

// 限流配置
export interface RateLimitConfig {
  // 时间窗口（毫秒）
  windowMs: number;
  // 窗口内最大请求数
  maxRequests: number;
  // 限流提示信息
  message?: string;
  // 自定义 key 生成器
  keyGenerator?: (req: NextRequest) => string;
  // 跳过限流的条件
  skip?: (req: NextRequest) => boolean;
  // 是否按用户限流（需要认证）
  perUser?: boolean;
}

// 限流结果
export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

// 存储接口
interface RateLimitStore {
  increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; reset: number }>;
  get(key: string): Promise<{ count: number; reset: number } | null>;
}

/**
 * 内存存储实现
 */
class MemoryStore implements RateLimitStore {
  private store: Map<string, { count: number; reset: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // 定期清理过期数据
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.store.entries()) {
        if (value.reset < now) {
          this.store.delete(key);
        }
      }
    }, 60000); // 每分钟清理一次
  }

  async increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; reset: number }> {
    const now = Date.now();
    const existing = this.store.get(key);

    if (existing && existing.reset > now) {
      // 窗口内，增加计数
      existing.count++;
      return { count: existing.count, reset: existing.reset };
    }

    // 新窗口
    const reset = now + windowMs;
    this.store.set(key, { count: 1, reset });
    return { count: 1, reset };
  }

  async get(key: string): Promise<{ count: number; reset: number } | null> {
    const value = this.store.get(key);
    if (value && value.reset > Date.now()) {
      return value;
    }
    return null;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store.clear();
  }
}

/**
 * Redis 存储实现（Stage 2.8 启用）
 *
 * 策略：INCR + EXPIRE 原子组合。
 * - 第一次增加某个 key 时设置 TTL = windowMs；之后的增加不重置 TTL → 自然形成滑动窗口的"固定窗口"近似。
 * - 若要严格滑动窗口（避免边界冲量），可换成 ZSET + ZADD/ZREMRANGEBYSCORE；当前实现在精度与开销之间选择了较轻的方案。
 * - 任何 Redis 异常都降级放行（返回 count=1），避免限流层本身成为 SPOF。
 */
class RedisStore implements RateLimitStore {
  async increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; reset: number }> {
    const redis = await getRedis();
    const now = Date.now();
    if (!redis) {
      // Redis 不可用 → 放行（调用方会使用 MemoryStore，这里是双保险）
      return { count: 1, reset: now + windowMs };
    }
    try {
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.pttl(key);
      const results = await pipeline.exec();
      if (!results) throw new Error("pipeline exec returned null");

      const count = Number(results[0]?.[1] ?? 1);
      let ttl = Number(results[1]?.[1] ?? -1);

      // 首次命中（或 key 过期）需要显式 set TTL
      if (ttl < 0) {
        await redis.pexpire(key, windowMs);
        ttl = windowMs;
      }

      return { count, reset: now + ttl };
    } catch (err) {
      log.warn("RedisStore.increment failed, failing open", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return { count: 1, reset: now + windowMs };
    }
  }

  async get(key: string): Promise<{ count: number; reset: number } | null> {
    const redis = await getRedis();
    if (!redis) return null;
    try {
      const [countStr, ttl] = await Promise.all([
        redis.get(key),
        redis.pttl(key),
      ]);
      if (!countStr || ttl < 0) return null;
      return { count: Number(countStr), reset: Date.now() + ttl };
    } catch {
      return null;
    }
  }
}

// 存储实例：生产按 env 判定；开发默认 memory
// 注意：REDIS_URL 存在但 Redis 暂时不可达时，RedisStore.increment 会自动失效（放行）
const store: RateLimitStore = process.env.REDIS_URL
  ? new RedisStore()
  : new MemoryStore();

/**
 * 创建限流器
 */
export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests, keyGenerator, skip, perUser = false } = config;

  return async function rateLimiter(
    req: NextRequest,
    userId?: string
  ): Promise<RateLimitResult> {
    // 检查是否跳过限流
    if (skip && skip(req)) {
      return {
        success: true,
        limit: maxRequests,
        remaining: maxRequests,
        reset: Date.now() + windowMs,
      };
    }

    // 生成限流 key
    let key: string;
    if (keyGenerator) {
      key = keyGenerator(req);
    } else if (perUser && userId) {
      key = `user:${userId}`;
    } else {
      // 默认使用 IP
      const forwarded = req.headers.get("x-forwarded-for");
      const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
      key = `ip:${ip}`;
    }

    // 添加路径前缀
    const pathname = new URL(req.url).pathname;
    key = `${pathname}:${key}`;

    // 增加计数
    const { count, reset } = await store.increment(key, windowMs);

    // 计算剩余请求数
    const remaining = Math.max(0, maxRequests - count);

    // 判断是否超过限制
    if (count > maxRequests) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return {
        success: false,
        limit: maxRequests,
        remaining: 0,
        reset,
        retryAfter,
      };
    }

    return {
      success: true,
      limit: maxRequests,
      remaining,
      reset,
    };
  };
}

/**
 * 限流响应头
 */
export function rateLimitHeaders(result: RateLimitResult): Headers {
  const headers = new Headers();
  headers.set("X-RateLimit-Limit", result.limit.toString());
  headers.set("X-RateLimit-Remaining", result.remaining.toString());
  headers.set("X-RateLimit-Reset", result.reset.toString());
  if (result.retryAfter) {
    headers.set("Retry-After", result.retryAfter.toString());
  }
  return headers;
}

/**
 * 创建限流错误响应
 */
export function rateLimitResponse(
  result: RateLimitResult,
  message = "请求过于频繁，请稍后再试"
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      retryAfter: result.retryAfter,
    },
    {
      status: 429,
      headers: rateLimitHeaders(result),
    }
  );
}

// 预定义的限流器配置
export const RATE_LIMITS = {
  // 通用 API 限流：每分钟 60 次
  default: {
    windowMs: 60 * 1000,
    maxRequests: 60,
  },

  // 认证相关：每分钟 10 次
  auth: {
    windowMs: 60 * 1000,
    maxRequests: 10,
  },

  // 图像生成：每分钟 10 次
  imageGeneration: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    perUser: true,
  },

  // 视频生成：每分钟 5 次
  videoGeneration: {
    windowMs: 60 * 1000,
    maxRequests: 5,
    perUser: true,
  },

  // 音频生成：每分钟 20 次
  audioGeneration: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    perUser: true,
  },

  // 导出：每小时 10 次
  export: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
    perUser: true,
  },

  // 支付：每分钟 5 次
  payment: {
    windowMs: 60 * 1000,
    maxRequests: 5,
    perUser: true,
  },

  // 严格限流：每分钟 3 次（敏感操作）
  strict: {
    windowMs: 60 * 1000,
    maxRequests: 3,
  },
} as const;

// 创建预定义的限流器实例
export const rateLimiters = {
  default: createRateLimiter(RATE_LIMITS.default),
  auth: createRateLimiter(RATE_LIMITS.auth),
  imageGeneration: createRateLimiter(RATE_LIMITS.imageGeneration),
  videoGeneration: createRateLimiter(RATE_LIMITS.videoGeneration),
  audioGeneration: createRateLimiter(RATE_LIMITS.audioGeneration),
  export: createRateLimiter(RATE_LIMITS.export),
  payment: createRateLimiter(RATE_LIMITS.payment),
  strict: createRateLimiter(RATE_LIMITS.strict),
};

/**
 * 中间件辅助函数：应用限流
 */
export async function withRateLimit(
  req: NextRequest,
  limiter: ReturnType<typeof createRateLimiter>,
  userId?: string
): Promise<NextResponse | null> {
  const result = await limiter(req, userId);

  if (!result.success) {
    return rateLimitResponse(result);
  }

  return null;
}
