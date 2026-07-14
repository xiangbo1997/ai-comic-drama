/**
 * Provider 共享工具函数
 */

import { safeFetch } from "@/lib/url-guard";
import {
  withRetry,
  isRetryableStatus,
  isTransientNetworkError,
  parseRetryAfter,
} from "@/lib/retry";

/** 移除 URL 末尾斜杠 */
export function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 安全取值（借鉴 yt-dlp 的 traverse_obj）。
 *
 * 按 path 逐层深入外部 API 响应；任意一层缺失/类型不符，抛**可读中文错误**
 * 而非裸下标的 `Cannot read property '0' of undefined`。用于替换各 provider
 * 里对上游 JSON 的裸深层下标（如 `data.choices[0].message.content`）——上游
 * 返回错误对象、触发内容安全过滤、或中转站返回非标准结构时，给出能指导排查
 * 的报错，而不是让整个生成流程崩在一句无信息的 TypeError 上。
 *
 * @param obj   外部响应对象
 * @param path  访问路径，字符串取属性、数字取数组下标，如 ["choices", 0, "message", "content"]
 * @param label 出错时的业务上下文（如 "LLM 对话响应"），拼进错误消息
 * @returns     命中路径的值（类型由调用方断言）
 */
export function pluckPath<T = unknown>(
  obj: unknown,
  path: ReadonlyArray<string | number>,
  label: string
): T {
  let current: unknown = obj;
  for (let i = 0; i < path.length; i += 1) {
    const key = path[i];
    if (current == null || typeof current !== "object") {
      const reached = path.slice(0, i).join(".") || "(根)";
      const snippet = safeSnippet(obj);
      throw new Error(
        `${label}结构异常：路径「${path.join(".")}」在「${reached}」处中断` +
          `（该层为 ${current === null ? "null" : typeof current}，非对象/数组）。\n` +
          `常见原因：上游返回了错误对象、触发了内容安全过滤、或中转站返回了非标准结构。\n` +
          `响应片段：${snippet}`
      );
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  if (current === undefined) {
    const snippet = safeSnippet(obj);
    throw new Error(
      `${label}缺少字段「${path.join(".")}」（值为 undefined）。\n` +
        `常见原因：上游返回了错误对象、触发了内容安全过滤、或中转站返回了非标准结构。\n` +
        `响应片段：${snippet}`
    );
  }
  return current as T;
}

/** 把外部响应截断成短片段，供报错时定位问题（防超长日志） */
function safeSnippet(obj: unknown): string {
  try {
    return JSON.stringify(obj).slice(0, 300);
  } catch {
    return String(obj).slice(0, 300);
  }
}

/**
 * 可重试的 HTTP 错误：携带状态码 + Retry-After，供 withRetry 的 shouldRetry 决策。
 * 只在 fetchWithError 内部对「值得重试的状态码」抛出；不可重试状态码走普通 Error。
 */
class RetryableHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null
  ) {
    super(message);
    this.name = "RetryableHttpError";
  }
}

/**
 * 带错误处理 + 网络层重试的 fetch 封装。
 *
 * SSRF 加固（2026-07-04）：走 safeFetch（钉 IP + 禁跟随重定向），
 * 因为多数 provider 的 url 拼自用户可控的 customBaseUrl。钉 IP 消除
 * 「配置校验 → 实际请求」之间的 DNS TOCTOU 窗口，redirect:error 堵
 * 302→内网绕过。固定官方域名的 provider 走此封装同样安全（无副作用）。
 *
 * 重试加固（借鉴 yt-dlp）：对 429 限流与 502/503/504/525 等网关瞬时故障、
 * 以及 TCP 断流做**指数退避 + 抖动**重试（默认最多 2 次），限流优先听上游
 * Retry-After。认证失败(401/403)、参数错误(400/404/422) 一次即抛，不浪费时间。
 * 注意：重试只发生在 HTTP/网络层，不触碰扣费逻辑（扣费在成功后由上层事务处理）。
 */
export async function fetchWithError(
  url: string,
  init: RequestInit,
  errorPrefix: string
): Promise<Response> {
  return withRetry(
    async () => {
      const response = await safeFetch(url, init);
      if (response.ok) return response;

      const errorText = await response.text();
      const message = `${errorPrefix}: ${response.status} ${errorText}`;
      if (isRetryableStatus(response.status)) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("retry-after")
        );
        throw new RetryableHttpError(message, response.status, retryAfterMs);
      }
      throw new Error(message);
    },
    {
      shouldRetry: (err) => {
        if (err instanceof RetryableHttpError) {
          return err.retryAfterMs != null
            ? { delayMs: err.retryAfterMs }
            : true;
        }
        return isTransientNetworkError(err);
      },
    }
  );
}

/** 通用宽高比转尺寸映射 */
export const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  "1:1": "1024x1024",
  "9:16": "1024x1792",
  "16:9": "1792x1024",
};

/** 硅基流动专用尺寸映射 */
export const ASPECT_RATIO_TO_SIZE_SF: Record<string, string> = {
  "1:1": "1024x1024",
  "9:16": "576x1024",
  "16:9": "1024x576",
};
