/**
 * DELETE /api/user/mcp-keys/[id] —— 吊销一把 MCP 密钥。
 *
 * 软删除（置 revokedAt）而非物理删除：保留签发/使用痕迹便于用户事后追查
 * 「这把泄露的密钥被用过没有」。鉴权侧对 revokedAt 非空的记录一律拒绝。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:user:mcp-keys:[id]");

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // 归属校验必须带 userId，否则任何登录用户都能吊销别人的密钥
    const key = await prisma.mcpApiKey.findFirst({
      where: { id, userId: session.user.id, revokedAt: null },
      select: { id: true },
    });
    if (!key) {
      return NextResponse.json({ error: "密钥不存在" }, { status: 404 });
    }

    await prisma.mcpApiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });

    log.info(`用户 ${session.user.id} 吊销 MCP 密钥 ${key.id}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Revoke MCP key error:", error);
    return NextResponse.json({ error: "吊销密钥失败" }, { status: 500 });
  }
}
