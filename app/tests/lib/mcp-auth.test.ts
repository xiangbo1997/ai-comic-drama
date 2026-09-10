import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  mcpApiKey: {
    findUnique: vi.fn<(args: unknown) => Promise<unknown>>(),
    update: vi.fn<(args: unknown) => Promise<unknown>>(),
  },
};

// 工厂内部惰性取值：vi.mock 会被提升到文件顶部，直接引用 prismaMock 会命中 TDZ
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpApiKey: {
      findUnique: (args: unknown) => prismaMock.mcpApiKey.findUnique(args),
      update: (args: unknown) => prismaMock.mcpApiKey.update(args),
    },
  },
}));

import {
  authenticateMcpRequest,
  generateMcpKey,
  hashMcpKey,
  mcpAuthChallenge,
  parseBearerToken,
  MCP_KEY_PREFIX,
} from "@/lib/mcp/auth";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.mcpApiKey.update.mockResolvedValue({});
});

describe("parseBearerToken()", () => {
  it("提取 Bearer 令牌", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("scheme 大小写不敏感（RFC 7235）", () => {
    expect(parseBearerToken("bearer abc123")).toBe("abc123");
    expect(parseBearerToken("BEARER abc123")).toBe("abc123");
  });

  it("缺失或格式不符返回 null", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
    expect(parseBearerToken("Basic abc123")).toBeNull();
    expect(parseBearerToken("Bearer ")).toBeNull();
  });
});

describe("generateMcpKey()", () => {
  it("明文带产品前缀，哈希与明文对得上", () => {
    const { plaintext, keyHash, keyPrefix } = generateMcpKey();
    expect(plaintext.startsWith(MCP_KEY_PREFIX)).toBe(true);
    expect(keyHash).toBe(hashMcpKey(plaintext));
    expect(plaintext.startsWith(keyPrefix)).toBe(true);
  });

  it("每次生成互不相同", () => {
    const a = generateMcpKey();
    const b = generateMcpKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it("落库的是哈希——明文不可从哈希还原（单向）", () => {
    const { plaintext, keyHash } = generateMcpKey();
    expect(keyHash).not.toContain(plaintext);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("authenticateMcpRequest()", () => {
  const validKey = "mcp_testkey";

  const makeRecord = (over: Record<string, unknown> = {}) => ({
    id: "key-1",
    userId: "user-1",
    keyHash: hashMcpKey(validKey),
    revokedAt: null,
    expiresAt: null,
    user: { status: "ACTIVE" },
    ...over,
  });

  it("有效密钥通过并回填用户", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(makeRecord());
    const result = await authenticateMcpRequest(`Bearer ${validKey}`);
    expect(result).toEqual({ ok: true, userId: "user-1", keyId: "key-1" });
  });

  it("按哈希查库——绝不用明文查询", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(makeRecord());
    await authenticateMcpRequest(`Bearer ${validKey}`);
    const arg = prismaMock.mcpApiKey.findUnique.mock.calls[0][0] as {
      where: { keyHash: string };
    };
    expect(arg.where.keyHash).toBe(hashMcpKey(validKey));
    expect(JSON.stringify(arg)).not.toContain(validKey);
  });

  it("缺 Authorization 头 → missing_token", async () => {
    const result = await authenticateMcpRequest(null);
    expect(result).toEqual({ ok: false, reason: "missing_token" });
    expect(prismaMock.mcpApiKey.findUnique).not.toHaveBeenCalled();
  });

  it("查不到记录 → invalid_token", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(null);
    const result = await authenticateMcpRequest("Bearer nope");
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("已吊销 → invalid_token", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(
      makeRecord({ revokedAt: new Date("2020-01-01") })
    );
    const result = await authenticateMcpRequest(`Bearer ${validKey}`);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("已过期 → invalid_token", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(
      makeRecord({ expiresAt: new Date(Date.now() - 1000) })
    );
    const result = await authenticateMcpRequest(`Bearer ${validKey}`);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("未到期的 expiresAt 仍然放行", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(
      makeRecord({ expiresAt: new Date(Date.now() + 60_000) })
    );
    const result = await authenticateMcpRequest(`Bearer ${validKey}`);
    expect(result.ok).toBe(true);
  });

  it("账号封禁 → account_banned（复用 Web 登录封禁语义）", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(
      makeRecord({ user: { status: "BANNED" } })
    );
    const result = await authenticateMcpRequest(`Bearer ${validKey}`);
    expect(result).toEqual({ ok: false, reason: "account_banned" });
  });

  it("成功后更新 lastUsedAt", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(makeRecord());
    await authenticateMcpRequest(`Bearer ${validKey}`);
    expect(prismaMock.mcpApiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "key-1" } })
    );
  });

  it("lastUsedAt 写失败不影响鉴权结果", async () => {
    prismaMock.mcpApiKey.findUnique.mockResolvedValue(makeRecord());
    prismaMock.mcpApiKey.update.mockRejectedValue(new Error("db down"));
    const result = await authenticateMcpRequest(`Bearer ${validKey}`);
    expect(result.ok).toBe(true);
  });
});

describe("mcpAuthChallenge()", () => {
  it("返回 401 且带 WWW-Authenticate 挑战头", () => {
    const res = mcpAuthChallenge(
      "missing_token",
      "https://example.com/.well-known/oauth-protected-resource"
    );
    expect(res.status).toBe(401);
    const header = res.headers.get("WWW-Authenticate") ?? "";
    expect(header).toContain("Bearer");
    expect(header).toContain("resource_metadata=");
  });

  it("封禁也报 invalid_token（不向未认证方泄露账号状态）", () => {
    const res = mcpAuthChallenge("account_banned", "https://example.com/meta");
    expect(res.headers.get("WWW-Authenticate")).toContain(
      'error="invalid_token"'
    );
  });
});
