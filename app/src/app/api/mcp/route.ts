/**
 * MCP 端点：POST /api/mcp
 *
 * 定位：**剧本工作台**——文本环节（起草世界观/写剧本/转分镜/角色花名册）走对话，
 * 视觉环节（出图/出视频/配音/导出）留在 Web UI。所有工具零扣费。
 *
 * 实现要点：
 * - SDK v2 的 `createMcpHandler` 返回 web 标准 `{ fetch }`，与 App Router 的
 *   Request/Response 天然契合，无需 @modelcontextprotocol/node（那是给 Node
 *   IncomingMessage/ServerResponse 的适配层，形状对不上）。
 * - factory 每请求新建一次 McpServer：无状态部署下不能跨请求共享实例。
 * - 鉴权走自签发的 Bearer 密钥（lib/mcp/auth.ts，SHA-256 单向哈希），在进
 *   handler 之前完成，未通过直接返回带 WWW-Authenticate 的 401。
 */

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { NextRequest } from "next/server";
import { authenticateMcpRequest, mcpAuthChallenge } from "@/lib/mcp/auth";
import { registerTools } from "@/lib/mcp/tools";
import { registerResources } from "@/lib/mcp/resources";
import { registerPrompts } from "@/lib/mcp/prompts";
import { resolveBaseUrl } from "@/lib/mcp/urls";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:mcp");

// 脚本生成是长文本 LLM 调用（实测 90-180 秒），与 drama-script 路由同档兜底
export const maxDuration = 300;

/** 供客户端发现鉴权方式的元数据地址（RFC 9728） */
function resourceMetadataUrl(baseUrl: string): string {
  return `${baseUrl}/.well-known/oauth-protected-resource`;
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await authenticateMcpRequest(
    request.headers.get("authorization")
  );

  if (!auth.ok) {
    log.warn(`MCP 鉴权失败：${auth.reason}`);
    return mcpAuthChallenge(
      auth.reason,
      resourceMetadataUrl(resolveBaseUrl(request))
    );
  }

  const handler = createMcpHandler(
    () => {
      const server = new McpServer({
        name: "ai-comic-drama",
        version: "1.0.0",
        title: "AI 漫剧剧本工作台",
      });

      registerTools(server, { userId: auth.userId, request });
      registerResources(server, auth.userId);
      registerPrompts(server);

      return server;
    },
    {
      onerror: (error) => log.error("MCP handler error:", error),
    }
  );

  try {
    return await handler.fetch(request, {
      // 鉴权已在上面完成，这里把结果透传给 handler（严格 pass-through：
      // SDK 自己不解析任何请求头，也不做校验）
      authInfo: {
        token: "",
        clientId: auth.keyId,
        scopes: ["mcp"],
        extra: { userId: auth.userId },
        // SDK 的 bearer 校验要求 expiresAt 存在；此处已自行鉴权，给一个
        // 短时效的占位值，避免被判为无效。
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });
  } finally {
    // 每请求实例用完即弃，释放 modern 腿上的在途交换
    await handler.close().catch(() => {});
  }
}

/**
 * GET / DELETE 是 2025 老协议的会话操作。当前走无状态服务，
 * SDK 会以 405 应答；这里显式导出以免 Next 报「方法未实现」。
 */
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: "method_not_allowed",
      message: "MCP 端点仅接受 POST",
    }),
    { status: 405, headers: { "Content-Type": "application/json" } }
  );
}
