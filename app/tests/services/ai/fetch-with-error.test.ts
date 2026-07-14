import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock safeFetch（fetchWithError 的唯一网络出口），用可编排的假响应/异常驱动重试逻辑。
const safeFetchMock = vi.fn();
vi.mock("@/lib/url-guard", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import { fetchWithError } from "@/services/ai/providers/base";

/** 构造带状态码 + 可选 retry-after 头的假响应 */
function makeResponse(
  status: number,
  body = "",
  retryAfter?: string
): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set("retry-after", retryAfter);
  return new Response(body, { status, headers });
}

/** 构造带 code 的网络异常 */
function netError(code: string, message = "network fail"): Error {
  return Object.assign(new Error(message), { code });
}

const INIT: RequestInit = { method: "POST", body: "{}" };

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("fetchWithError — standard 模式（默认）", () => {
  it("2xx 直接返回，不重试", async () => {
    safeFetchMock.mockResolvedValueOnce(makeResponse(200, "ok"));
    const res = await fetchWithError("https://x", INIT, "test");
    expect(res.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 可重试：带 retry-after=0 时快速重试直到成功", async () => {
    safeFetchMock
      .mockResolvedValueOnce(makeResponse(429, "rate limited", "0"))
      .mockResolvedValueOnce(makeResponse(200, "ok"));
    const res = await fetchWithError("https://x", INIT, "test");
    expect(res.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("502/503 属网关瞬时故障，standard 模式会重试", async () => {
    for (const status of [502, 503]) {
      safeFetchMock.mockReset();
      safeFetchMock
        .mockResolvedValueOnce(makeResponse(status, "gateway", "0"))
        .mockResolvedValueOnce(makeResponse(200, "ok"));
      const res = await fetchWithError("https://x", INIT, "test");
      expect(res.status).toBe(200);
      expect(safeFetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("500 不再重试：一次即抛普通 Error", async () => {
    safeFetchMock.mockResolvedValue(makeResponse(500, "boom"));
    await expect(fetchWithError("https://x", INIT, "prefix")).rejects.toThrow(
      /prefix: 500/
    );
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("401/400 认证与参数错误不重试", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      safeFetchMock.mockReset();
      safeFetchMock.mockResolvedValue(makeResponse(status, "bad"));
      await expect(fetchWithError("https://x", INIT, "p")).rejects.toThrow();
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("最终失败抛普通 Error（RetryableHttpError 不外泄）", async () => {
    // 每次调用返回全新 Response——同一实例的 body 被首次 .text() 消费后不可复用
    safeFetchMock.mockImplementation(() =>
      Promise.resolve(makeResponse(429, "always limited", "0"))
    );
    try {
      await fetchWithError("https://x", INIT, "prefix");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).not.toBe("RetryableHttpError");
      expect((e as Error).message).toMatch(/prefix: 429/);
    }
  });
});

describe("fetchWithError — submit 模式（非幂等生成提交）", () => {
  it("429 仍重试（任务未启动，重试安全）", async () => {
    safeFetchMock
      .mockResolvedValueOnce(makeResponse(429, "rate limited", "0"))
      .mockResolvedValueOnce(makeResponse(200, "ok"));
    const res = await fetchWithError("https://x", INIT, "test", "submit");
    expect(res.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("502/503/504 网关 5xx 一律不重试（后端可能已开始生成）", async () => {
    for (const status of [502, 503, 504]) {
      safeFetchMock.mockReset();
      safeFetchMock.mockResolvedValue(makeResponse(status, "gateway"));
      await expect(
        fetchWithError("https://x", INIT, "p", "submit")
      ).rejects.toThrow();
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("连接建立阶段失败（ECONNREFUSED/ENOTFOUND）重试", async () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND"]) {
      safeFetchMock.mockReset();
      safeFetchMock
        .mockRejectedValueOnce(netError(code))
        .mockResolvedValueOnce(makeResponse(200, "ok"));
      const res = await fetchWithError("https://x", INIT, "p", "submit");
      expect(res.status).toBe(200);
      expect(safeFetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("中途 TCP 断流（ECONNRESET）不重试——防重复生成翻倍配额", async () => {
    safeFetchMock.mockRejectedValue(netError("ECONNRESET", "socket hang up"));
    await expect(
      fetchWithError("https://x", INIT, "p", "submit")
    ).rejects.toThrow(/socket hang up/);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });
});
