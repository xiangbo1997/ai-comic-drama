import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { checkMcpRateLimit, MCP_RATE_LIMITS } from "@/lib/mcp/rate-limit";

/**
 * 关键回归点：MCP 全部工具走 `/api/mcp` 单一端点，而 createRateLimiter 会给
 * key 无条件加 pathname 前缀。若不用自定义 keyGenerator 把工具名编进 key，
 * 所有工具会共享同一个桶——一次脚本生成就能把其它工具挤爆。
 */
function makeReq(): NextRequest {
  return new NextRequest(new URL("/api/mcp", "http://localhost:3000"), {
    method: "POST",
    headers: { "x-forwarded-for": "10.0.0.1" },
  });
}

describe("checkMcpRateLimit() —— 按工具分桶", () => {
  it("同一端点下不同工具互不影响", async () => {
    const req = makeReq();
    // 把 mcpLlm（每分钟 5 次）打满
    for (let i = 0; i < MCP_RATE_LIMITS.mcpLlm.maxRequests; i++) {
      const r = await checkMcpRateLimit(req, "mcpLlm", "tool_a", "user-iso");
      expect(r.success).toBe(true);
    }
    const blocked = await checkMcpRateLimit(
      req,
      "mcpLlm",
      "tool_a",
      "user-iso"
    );
    expect(blocked.success).toBe(false);

    // 另一个工具应完全不受影响（这正是 pathname 前缀坑的回归点）
    const other = await checkMcpRateLimit(req, "mcpLlm", "tool_b", "user-iso");
    expect(other.success).toBe(true);
  });

  it("同一工具下不同用户互不影响", async () => {
    const req = makeReq();
    for (let i = 0; i < MCP_RATE_LIMITS.mcpLlm.maxRequests; i++) {
      await checkMcpRateLimit(req, "mcpLlm", "shared_tool", "user-x");
    }
    const blocked = await checkMcpRateLimit(
      req,
      "mcpLlm",
      "shared_tool",
      "user-x"
    );
    expect(blocked.success).toBe(false);

    const otherUser = await checkMcpRateLimit(
      req,
      "mcpLlm",
      "shared_tool",
      "user-y"
    );
    expect(otherUser.success).toBe(true);
  });

  it("mcpDefault 档位比 mcpLlm 宽松", async () => {
    const req = makeReq();
    const r = await checkMcpRateLimit(req, "mcpDefault", "t", "user-tier");
    expect(r.limit).toBe(MCP_RATE_LIMITS.mcpDefault.maxRequests);
    expect(MCP_RATE_LIMITS.mcpDefault.maxRequests).toBeGreaterThan(
      MCP_RATE_LIMITS.mcpLlm.maxRequests
    );
  });

  it("超限时给出 retryAfter 供提示用户", async () => {
    const req = makeReq();
    for (let i = 0; i < MCP_RATE_LIMITS.mcpLlm.maxRequests; i++) {
      await checkMcpRateLimit(req, "mcpLlm", "retry_tool", "user-r");
    }
    const blocked = await checkMcpRateLimit(
      req,
      "mcpLlm",
      "retry_tool",
      "user-r"
    );
    expect(blocked.success).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
