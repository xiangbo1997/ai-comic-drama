/**
 * MCP 工具限流。
 *
 * 坑：lib/rate-limit.ts 的 createRateLimiter 无条件给 key 加 `pathname` 前缀
 * （rate-limit.ts:205-207）。MCP 所有工具都走 `/api/mcp` 这一个端点，若沿用默认
 * perUser 键，全部工具会共享同一个桶——一次脚本生成就能把角色起草也挤爆。
 *
 * 解法：用 createRateLimiter 已支持的 keyGenerator 选项（rate-limit.ts:176）把
 * 工具名与用户 id 编进 key。注意 keyGenerator 的签名只收 NextRequest、不收
 * userId，所以这里用闭包工厂：每次调用现场构造限流器，把 userId 闭包进去。
 * 全程零改动 rate-limit.ts 源文件。
 */

import type { NextRequest } from "next/server";
import { createRateLimiter, type RateLimitResult } from "@/lib/rate-limit";

/** MCP 专用限流档位（与 RATE_LIMITS 的既有档位并列，不复用以免相互影响） */
export const MCP_RATE_LIMITS = {
  /** 常规工具：建项目/读资料等轻量操作 */
  mcpDefault: { windowMs: 60 * 1000, maxRequests: 30 },
  /** LLM 工具：脚本生成单次约 90 秒，压低频次防止把上游打爆 */
  mcpLlm: { windowMs: 60 * 1000, maxRequests: 5 },
} as const;

export type McpRateLimitTier = keyof typeof MCP_RATE_LIMITS;

/**
 * 对某个工具调用做限流。
 *
 * key 形如 `mcp:generate_drama_script:user:<id>`，叠加 createRateLimiter 自带的
 * pathname 前缀后，最终是 `/api/mcp:mcp:<tool>:user:<id>`——按工具分桶。
 */
export async function checkMcpRateLimit(
  request: NextRequest,
  tier: McpRateLimitTier,
  toolName: string,
  userId: string
): Promise<RateLimitResult> {
  const limiter = createRateLimiter({
    ...MCP_RATE_LIMITS[tier],
    keyGenerator: () => `mcp:${toolName}:user:${userId}`,
  });
  return limiter(request, userId);
}

/** 拼给模型看的限流提示，说明还要等多久 */
export function mcpRateLimitMessage(result: RateLimitResult): string {
  const wait = result.retryAfter ?? 60;
  return `调用过于频繁（每分钟上限 ${result.limit} 次），请 ${wait} 秒后重试。`;
}
