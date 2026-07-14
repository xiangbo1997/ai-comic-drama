import { describe, it, expect } from "vitest";
import {
  isRetryableStatus,
  isTransientNetworkError,
  parseRetryAfter,
  withRetry,
} from "@/lib/retry";

describe("isRetryableStatus", () => {
  it("429 限流与 5xx/52x 网关瞬时故障可重试", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(504)).toBe(true);
    expect(isRetryableStatus(525)).toBe(true); // Cloudflare 中转常见
  });

  it("认证/参数类错误不重试", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });
});

describe("isTransientNetworkError", () => {
  it("识别 TCP 断流 code", () => {
    const err = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("识别 cause 内嵌的断流", () => {
    const err = Object.assign(new Error("fetch failed"), {
      cause: { code: "ETIMEDOUT" },
    });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("识别 undici 'terminated'", () => {
    expect(isTransientNetworkError(new Error("terminated"))).toBe(true);
  });

  it("普通业务错误不算瞬时", () => {
    expect(isTransientNetworkError(new Error("invalid api key"))).toBe(false);
    expect(isTransientNetworkError("not an error")).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("解析纯秒数为毫秒", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("1.5")).toBe(1500);
  });

  it("空/非法返回 null", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });

  it("解析 HTTP-date 为正的等待毫秒", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(0);
    expect(ms!).toBeLessThanOrEqual(5000);
  });

  it("过去时间夹到 0，不产生负等待", () => {
    const past = new Date(Date.now() - 10000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });
});

describe("withRetry", () => {
  it("首次成功不重试", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("瞬时失败后重试直到成功", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("terminated"); // 前两次瞬时失败
        return "recovered";
      },
      { baseDelayMs: 1, maxRetries: 3 }
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("达到最大重试次数后抛最后一个错误", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("terminated");
        },
        { baseDelayMs: 1, maxRetries: 2 }
      )
    ).rejects.toThrow("terminated");
    expect(calls).toBe(3); // 1 次首发 + 2 次重试
  });

  it("不可重试错误立即抛出，不重试", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("invalid api key");
        },
        { baseDelayMs: 1, maxRetries: 3, shouldRetry: () => false }
      )
    ).rejects.toThrow("invalid api key");
    expect(calls).toBe(1);
  });

  it("shouldRetry 返回 {delayMs} 时仍重试（尊重 Retry-After 路径）", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("rate limited");
        return "done";
      },
      { maxRetries: 2, shouldRetry: () => ({ delayMs: 1 }) }
    );
    expect(result).toBe("done");
    expect(calls).toBe(2);
  });
});
