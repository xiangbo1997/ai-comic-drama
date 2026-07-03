/**
 * 积分流水查询 API
 *
 * GET /api/user/credit-transactions
 * 返回当前用户最近 50 条积分变动记录（消费 / 失败退款 / 充值 / 签到 / 邀请）。
 * lib/credits.ts 早已为每笔变动写入 CreditTransaction 流水，但前端此前无任何
 * 展示入口——用户遇到「生成失败但积分变少」时无法自证退款是否到账。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:user:credit-transactions");

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const transactions = await prisma.creditTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        delta: true,
        balanceAfter: true,
        type: true,
        note: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ transactions });
  } catch (error) {
    log.error("Get credit transactions error:", error);
    return NextResponse.json({ error: "获取积分明细失败" }, { status: 500 });
  }
}
