import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * 注意：rate-limit.ts 模块级变量 `store` 在模块首次加载时根据 REDIS_URL 决定类型。
 * setup.ts 已删除 REDIS_URL，因此这里拿到的是 MemoryStore。
 */

function makeReq(path = "/api/test"): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "x-forwarded-for": "10.0.0.1" },
  });
}

describe("createRateLimiter() — MemoryStore branch (no REDIS_URL)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", async () => {
    const limiter = createRateLimiter({
      windowMs: 1000,
      maxRequests: 3,
      perUser: true,
    });
    const req = makeReq("/api/limit-under");
    for (let i = 0; i < 3; i++) {
      const r = await limiter(req, "user-a");
      expect(r.success).toBe(true);
    }
  });

  it("blocks the 4th request within window when limit is 3", async () => {
    const limiter = createRateLimiter({
      windowMs: 1000,
      maxRequests: 3,
      perUser: true,
    });
    const req = makeReq("/api/limit-block");
    for (let i = 0; i < 3; i++) {
      await limiter(req, "user-b");
    }
    const r = await limiter(req, "user-b");
    expect(r.success).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfter).toBeGreaterThan(0);
  });

  it("resets counter after window expires", async () => {
    const limiter = createRateLimiter({
      windowMs: 500,
      maxRequests: 1,
      perUser: true,
    });
    const req = makeReq("/api/limit-reset");
    const first = await limiter(req, "user-c");
    expect(first.success).toBe(true);

    // 推进时间 600ms > 500ms 窗口
    vi.setSystemTime(Date.now() + 600);

    const second = await limiter(req, "user-c");
    expect(second.success).toBe(true);
  });
});
