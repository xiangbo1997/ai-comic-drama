/**
 * Provider 共享工具函数
 */

import { safeFetch } from "@/lib/url-guard";

/** 移除 URL 末尾斜杠 */
export function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 带错误处理的 fetch 封装。
 *
 * SSRF 加固（2026-07-04）：走 safeFetch（钉 IP + 禁跟随重定向），
 * 因为多数 provider 的 url 拼自用户可控的 customBaseUrl。钉 IP 消除
 * 「配置校验 → 实际请求」之间的 DNS TOCTOU 窗口，redirect:error 堵
 * 302→内网绕过。固定官方域名的 provider 走此封装同样安全（无副作用）。
 */
export async function fetchWithError(
  url: string,
  init: RequestInit,
  errorPrefix: string
): Promise<Response> {
  const response = await safeFetch(url, init);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${errorPrefix}: ${response.status} ${errorText}`);
  }
  return response;
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
