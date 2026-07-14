/**
 * Provider 共享工具函数
 */

import { safeFetch } from "@/lib/url-guard";
import {
  withRetry,
  isRetryableStatus,
  isTransientNetworkError,
  isConnectionPhaseError,
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
 * fetchWithError 的重试模式。
 *
 * - "standard"：幂等/只读请求（状态轮询 GET、LLM 对话等无副作用调用）。
 *   对 429 + 网关瞬时故障（502/503/504/52x）+ 全部 TCP 断流做指数退避重试。
 * - "submit"：**非幂等的生成提交 POST**（图像/视频提交，请求会挂满整段 10-60s 生成）。
 *   只对 429（任务在启动前被拒，重试安全）与「连接建立阶段」失败（DNS/拒连/连接前超时，
 *   请求肯定没到后端）重试；对 500/502/503/504 网关错误与中途 TCP 断流**一律不重试**——
 *   因为后端可能已开始生成，重试会触发整段重新生成 → 双倍上游配额消耗。
 */
export type RetryMode = "standard" | "submit";

/**
 * 带错误处理 + 网络层重试的 fetch 封装。
 *
 * SSRF 加固（2026-07-04）：走 safeFetch（钉 IP + 禁跟随重定向），
 * 因为多数 provider 的 url 拼自用户可控的 customBaseUrl。钉 IP 消除
 * 「配置校验 → 实际请求」之间的 DNS TOCTOU 窗口，redirect:error 堵
 * 302→内网绕过。固定官方域名的 provider 走此封装同样安全（无副作用）。
 *
 * 重试加固（借鉴 yt-dlp）：对 429 限流与 502/503/504/52x 等网关瞬时故障、
 * 以及 TCP 断流做**指数退避 + 抖动**重试（默认最多 2 次），限流优先听上游
 * Retry-After。认证失败(401/403)、参数错误(400/404/422) 一次即抛，不浪费时间。
 * 注意：重试只发生在 HTTP/网络层，不触碰扣费逻辑（扣费在成功后由上层事务处理）。
 *
 * retryMode（默认 "standard"）：非幂等的生成提交 POST 须显式传 "submit"，
 * 收窄重试面以防「中途断流 / 网关 5xx」触发整段重复生成 → 双倍上游配额浪费。
 * 详见 RetryMode 文档。RetryableHttpError 仍是内部实现，调用方最终只见普通 Error。
 */
export async function fetchWithError(
  url: string,
  init: RequestInit,
  errorPrefix: string,
  retryMode: RetryMode = "standard"
): Promise<Response> {
  try {
    return await withRetry(
      async () => {
        const response = await safeFetch(url, init);
        if (response.ok) return response;

        const errorText = await response.text();
        const message = `${errorPrefix}: ${response.status} ${errorText}`;
        // submit 模式：只把 429 当可重试状态码（任务未启动，重试安全）；
        // 其余 5xx 走普通 Error 一次即抛，避免非幂等提交被重复触发。
        const statusRetryable =
          retryMode === "submit"
            ? response.status === 429
            : isRetryableStatus(response.status);
        if (statusRetryable) {
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
          // submit 模式对网络错误只认「连接建立阶段」失败（请求没到后端）；
          // standard 模式认全部瞬时断流。
          return retryMode === "submit"
            ? isConnectionPhaseError(err)
            : isTransientNetworkError(err);
        },
      }
    );
  } catch (err) {
    // 重试耗尽后，把内部的 RetryableHttpError 拆成普通 Error 再冒泡——
    // RetryableHttpError 只服务于 withRetry 的重试决策，不应外泄给调用方。
    if (err instanceof RetryableHttpError) {
      throw new Error(err.message);
    }
    throw err;
  }
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
