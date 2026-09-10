/**
 * MCP 返回值里的网页深链。
 *
 * 这是 MCP 与 Web UI 的交接点：文本环节在对话里做完，视觉环节（出图/配音/导出）
 * 让用户点进编辑器继续。每个改动型工具都必须回 editorUrl，否则用户拿到 projectId
 * 也不知道去哪儿继续。
 */

import type { NextRequest } from "next/server";

/**
 * 解析站点根地址。
 *
 * 优先环境变量（生产固定域名最可靠），回落到请求头推断，便于本地开发直接可用。
 */
export function resolveBaseUrl(request: NextRequest): string {
  const configured =
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  if (configured) return configured.replace(/\/+$/, "");

  // 反代后 host 在 x-forwarded-* 里；本地开发回落到 Host 头
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** 编辑器深链 */
export function editorUrl(baseUrl: string, projectId: string): string {
  return `${baseUrl}/editor/${projectId}`;
}

/** 项目列表页 */
export function projectsUrl(baseUrl: string): string {
  return `${baseUrl}/projects`;
}
