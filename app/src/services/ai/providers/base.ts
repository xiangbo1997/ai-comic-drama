/**
 * Provider 共享工具函数
 */

/** 移除 URL 末尾斜杠 */
export function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** 带错误处理的 fetch 封装 */
export async function fetchWithError(
  url: string,
  init: RequestInit,
  errorPrefix: string
): Promise<Response> {
  const response = await fetch(url, init);
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
