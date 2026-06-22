import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:user:credits");

// 获取用户积分
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { credits: true },
    });

    return NextResponse.json({ credits: user?.credits ?? 0 });
  } catch (error) {
    log.error("Get credits error:", error);
    return NextResponse.json(
      { error: "Failed to get credits" },
      { status: 500 }
    );
  }
}

// 注：原 POST 扣减积分端点已删除。
// 它存在 TOCTOU 竞态（读余额→判断→扣减无事务，可并发扣成负数），且绕过
// lib/credits.chargeCredits 的事务/流水/幂等保护。前端从未调用该 POST
// （仅用 GET 读余额）。所有扣费必须经 chargeCredits 收口，故移除该旁路。
