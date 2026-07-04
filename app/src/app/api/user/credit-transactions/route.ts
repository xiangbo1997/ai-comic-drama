/**
 * 积分流水查询 API
 *
 * GET /api/user/credit-transactions?cursor=<id>
 * 游标分页返回当前用户的积分变动记录（消费 / 失败退款 / 充值 / 签到 / 邀请），
 * 每页 20 条，响应含 nextCursor（null 表示没有更多）。
 * lib/credits.ts 早已为每笔变动写入 CreditTransaction 流水，但前端此前无任何
 * 展示入口——用户遇到「生成失败但积分变少」时无法自证退款是否到账。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:user:credit-transactions");

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cursor = request.nextUrl.searchParams.get("cursor");

    // 多取 1 条探测是否还有下一页；createdAt 可能重复，叠加 id 保证游标序确定
    const rows = await prisma.creditTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        delta: true,
        balanceAfter: true,
        type: true,
        note: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > PAGE_SIZE;
    const transactions = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    return NextResponse.json({
      transactions,
      nextCursor: hasMore ? transactions[transactions.length - 1].id : null,
    });
  } catch (error) {
    log.error("Get credit transactions error:", error);
    return NextResponse.json({ error: "获取积分明细失败" }, { status: 500 });
  }
}
