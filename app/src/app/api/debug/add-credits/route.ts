import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:debug:add-credits");

// 调试用：为当前用户添加积分
export async function GET(request: NextRequest) {
  // 仅在开发环境可用
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 从 URL 参数获取要添加的积分数量，默认 10000
    const { searchParams } = new URL(request.url);
    const amount = parseInt(searchParams.get("amount") || "10000", 10);

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { credits: { increment: amount } },
      select: { credits: true, email: true },
    });

    log.info(`[DEBUG] Credits added: user=${session.user.email}, amount=${amount}, new_total=${updatedUser.credits}`);

    return NextResponse.json({
      success: true,
      added: amount,
      credits: updatedUser.credits,
      user: session.user.email,
    });
  } catch (error) {
    log.error("Add credits error:", error);
    return NextResponse.json(
      { error: "Failed to add credits" },
      { status: 500 }
    );
  }
}
