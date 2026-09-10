/**
 * MCP 接入密钥的签发与校验。
 *
 * 与 lib/encryption.ts 的 AES 可逆加密**刻意不同**：那套是给第三方 API Key 用的
 * （调用上游必须解密回明文）；这里是我们自己签发的凭证，只需判断「入参是否等于
 * 已签发的某把钥匙」，所以走 SHA-256 单向哈希——明文只在生成时返回一次，落库的
 * 哈希不可逆，即便数据库泄露也无法还原出可用密钥。
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

/** 密钥明文前缀，便于用户在一堆字符串里认出这是本产品的 MCP 密钥 */
export const MCP_KEY_PREFIX = "mcp_";

/** keyPrefix 列存的明文长度（前缀 + 前 8 位随机串），仅供 UI 辨识 */
const DISPLAY_PREFIX_LENGTH = MCP_KEY_PREFIX.length + 8;

/** 鉴权失败的原因，供调用方决定返回 401 还是 403 */
export type McpAuthFailure =
  | "missing_token" // 没带 Authorization 头
  | "invalid_token" // 哈希查不到 / 已吊销 / 已过期
  | "account_banned"; // 账号被封禁

export interface McpAuthSuccess {
  ok: true;
  userId: string;
  keyId: string;
}

export interface McpAuthError {
  ok: false;
  reason: McpAuthFailure;
}

export type McpAuthResult = McpAuthSuccess | McpAuthError;

/** 生成一把新密钥，返回明文（仅此一次）与入库所需字段 */
export function generateMcpKey(): {
  plaintext: string;
  keyHash: string;
  keyPrefix: string;
} {
  // 32 字节 base64url ≈ 43 字符，熵足够且无需转义即可放进 HTTP 头
  const plaintext = `${MCP_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    plaintext,
    keyHash: hashMcpKey(plaintext),
    keyPrefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

/** SHA-256 哈希（hex）。单向，永不解密——校验时哈希入参再比对。 */
export function hashMcpKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * 从 `Authorization: Bearer <token>` 取出明文密钥。
 * 大小写不敏感（RFC 7235 规定 scheme 不区分大小写）。
 */
export function parseBearerToken(
  authorizationHeader: string | null | undefined
): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(authorizationHeader.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * 校验 Authorization 头，成功返回归属用户。
 *
 * 通过唯一索引 keyHash 直接命中，再逐项检查吊销/过期/封号。查到记录后仍做一次
 * 定长比较：唯一索引查询本身不构成时序侧信道，但比较是免费的，保持防御姿态。
 */
export async function authenticateMcpRequest(
  authorizationHeader: string | null | undefined
): Promise<McpAuthResult> {
  const token = parseBearerToken(authorizationHeader);
  if (!token) return { ok: false, reason: "missing_token" };

  const keyHash = hashMcpKey(token);
  const record = await prisma.mcpApiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      userId: true,
      keyHash: true,
      revokedAt: true,
      expiresAt: true,
      user: { select: { status: true } },
    },
  });

  if (!record || !constantTimeEquals(record.keyHash, keyHash)) {
    return { ok: false, reason: "invalid_token" };
  }
  if (record.revokedAt) return { ok: false, reason: "invalid_token" };
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "invalid_token" };
  }
  // 复用 Web 登录的封禁语义（lib/auth.ts authorize 同款判断）
  if (record.user.status === "BANNED") {
    return { ok: false, reason: "account_banned" };
  }

  // 「最近使用」仅供用户识别僵尸密钥，写失败不该拖垮整个请求
  await prisma.mcpApiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { ok: true, userId: record.userId, keyId: record.id };
}

/** 定长字符串比较，避免按字节短路泄露信息 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 构造符合 RFC 9728 的鉴权失败响应。
 *
 * 带 `WWW-Authenticate` 挑战头是 MCP 规范对受保护资源的要求：客户端据此发现
 * 该端点需要凭证。当前用静态密钥而非 OAuth，仍给出 resource_metadata 指针，
 * 保持规范姿态、也为后续接 OAuth 留位置。
 */
export function mcpAuthChallenge(
  reason: McpAuthFailure,
  resourceMetadataUrl: string
): Response {
  const banned = reason === "account_banned";
  // 对外统一报 invalid_token：不向未通过认证的一方泄露「这个账号存在但被封了」
  const error = banned ? "invalid_token" : reason;
  const description = banned
    ? "账号已被封禁"
    : reason === "missing_token"
      ? "缺少 MCP 接入密钥"
      : "MCP 接入密钥无效或已过期";

  // HTTP 头只能是 ByteString（Latin-1），中文描述放 JSON 体，头里用 ASCII 版本
  const asciiDescription = banned
    ? "Account is banned"
    : reason === "missing_token"
      ? "Missing MCP API key"
      : "Invalid or expired MCP API key";

  return new Response(
    JSON.stringify({ error, error_description: description }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}", error="${error}", error_description="${asciiDescription}"`,
      },
    }
  );
}
