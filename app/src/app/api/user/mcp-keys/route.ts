/**
 * MCP 接入密钥管理：GET 列表 / POST 新建。
 *
 * 明文密钥**只在 POST 响应里出现这一次**，之后库里只有 SHA-256 哈希，
 * 任何接口都无法再取回——与「密钥等同账号密码」的定位一致。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateMcpKey } from "@/lib/mcp/auth";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:user:mcp-keys");

/** 单账号最多持有的有效密钥数，防止无限签发 */
const MAX_ACTIVE_KEYS = 10;

const CreateSchema = z.object({
  name: z.string().trim().min(1, "请填写密钥用途").max(50),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** GET：列出本账号的密钥（不含明文，只有前缀） */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const keys = await prisma.mcpApiKey.findMany({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      keys: keys.map((k) => ({
        ...k,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
        expired: k.expiresAt ? k.expiresAt.getTime() <= Date.now() : false,
      })),
    });
  } catch (error) {
    log.error("List MCP keys error:", error);
    return NextResponse.json({ error: "获取密钥列表失败" }, { status: 500 });
  }
}

/** POST：签发一把新密钥，明文仅此一次返回 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // 签发是敏感写操作，套用严格档限流
    const rl = await rateLimiters.strictPerUser(request, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "操作过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    const parsed = CreateSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "参数错误" },
        { status: 400 }
      );
    }

    const activeCount = await prisma.mcpApiKey.count({
      where: { userId, revokedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_KEYS) {
      return NextResponse.json(
        { error: `最多同时持有 ${MAX_ACTIVE_KEYS} 把密钥，请先吊销不用的` },
        { status: 400 }
      );
    }

    const { plaintext, keyHash, keyPrefix } = generateMcpKey();
    const expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
      : null;

    const created = await prisma.mcpApiKey.create({
      data: {
        userId,
        name: parsed.data.name,
        keyHash,
        keyPrefix,
        expiresAt,
      },
      select: { id: true, name: true, keyPrefix: true, createdAt: true },
    });

    log.info(`用户 ${userId} 签发 MCP 密钥 ${created.id}`);

    return NextResponse.json(
      {
        key: {
          ...created,
          createdAt: created.createdAt.toISOString(),
          expiresAt: expiresAt?.toISOString() ?? null,
        },
        // 明文仅此一次；前端必须提示用户立刻保存
        plaintext,
      },
      { status: 201 }
    );
  } catch (error) {
    log.error("Create MCP key error:", error);
    return NextResponse.json({ error: "创建密钥失败" }, { status: 500 });
  }
}
