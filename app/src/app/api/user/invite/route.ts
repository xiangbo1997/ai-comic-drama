import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:user:invite");

const INVITE_REWARD = 50; // 邀请奖励积分

// 获取邀请信息
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 获取用户邀请码
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { inviteCode: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // 获取邀请统计
    const invitations = await prisma.invitation.findMany({
      where: { inviterId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const completedCount = invitations.filter(
      (i) => i.status === "COMPLETED"
    ).length;
    const totalEarned = completedCount * INVITE_REWARD;

    return NextResponse.json({
      inviteCode: user.inviteCode,
      inviteLink: `${process.env.NEXTAUTH_URL || ""}/login?invite=${user.inviteCode}`,
      stats: {
        total: invitations.length,
        completed: completedCount,
        pending: invitations.filter((i) => i.status === "PENDING").length,
        totalEarned,
      },
      recentInvitations: invitations.map((i) => ({
        id: i.id,
        email: i.inviteeEmail.replace(/(.{2}).*(@.*)/, "$1***$2"), // 隐藏部分邮箱
        status: i.status,
        credits: i.credits,
        createdAt: i.createdAt,
        completedAt: i.completedAt,
      })),
    });
  } catch (error) {
    log.error("Get invite info error:", error);
    return NextResponse.json(
      { error: "Failed to get invite info" },
      { status: 500 }
    );
  }
}

// 验证邀请码
export async function POST(request: NextRequest) {
  try {
    const { inviteCode } = await request.json();

    if (!inviteCode) {
      return NextResponse.json(
        { error: "Invite code is required" },
        { status: 400 }
      );
    }

    // 查找邀请人
    const inviter = await prisma.user.findUnique({
      where: { inviteCode },
      select: { id: true, name: true, email: true },
    });

    if (!inviter) {
      return NextResponse.json(
        { error: "Invalid invite code" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      valid: true,
      inviter: {
        name: inviter.name || inviter.email?.split("@")[0] || "用户",
      },
      reward: INVITE_REWARD,
    });
  } catch (error) {
    log.error("Validate invite code error:", error);
    return NextResponse.json(
      { error: "Failed to validate invite code" },
      { status: 500 }
    );
  }
}
