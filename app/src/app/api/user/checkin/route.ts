import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:user:checkin");

const CHECKIN_CREDITS = 5;

// 获取签到状态
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 检查今天是否已签到
    const todayCheckin = await prisma.checkin.findUnique({
      where: {
        userId_date: {
          userId: session.user.id,
          date: today,
        },
      },
    });

    // 获取连续签到天数
    const checkins = await prisma.checkin.findMany({
      where: { userId: session.user.id },
      orderBy: { date: "desc" },
      take: 30,
    });

    let streak = 0;
    const checkDate = new Date(today);

    for (const checkin of checkins) {
      const checkinDate = new Date(checkin.date);
      checkinDate.setHours(0, 0, 0, 0);

      if (checkinDate.getTime() === checkDate.getTime()) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (checkinDate.getTime() === checkDate.getTime() - 86400000) {
        // 昨天
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // 获取本月签到记录
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const monthlyCheckins = await prisma.checkin.findMany({
      where: {
        userId: session.user.id,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      select: { date: true },
    });

    return NextResponse.json({
      checkedInToday: !!todayCheckin,
      streak,
      monthlyCheckins: monthlyCheckins.map((c) => c.date.toISOString().split("T")[0]),
      creditsPerCheckin: CHECKIN_CREDITS,
    });
  } catch (error) {
    log.error("Get checkin status error:", error);
    return NextResponse.json(
      { error: "Failed to get checkin status" },
      { status: 500 }
    );
  }
}

// 执行签到
export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 检查今天是否已签到
    const existingCheckin = await prisma.checkin.findUnique({
      where: {
        userId_date: {
          userId: session.user.id,
          date: today,
        },
      },
    });

    if (existingCheckin) {
      return NextResponse.json(
        { error: "Already checked in today" },
        { status: 400 }
      );
    }

    // 创建签到记录并增加积分
    const [checkin] = await prisma.$transaction([
      prisma.checkin.create({
        data: {
          userId: session.user.id,
          date: today,
          credits: CHECKIN_CREDITS,
        },
      }),
      prisma.user.update({
        where: { id: session.user.id },
        data: { credits: { increment: CHECKIN_CREDITS } },
      }),
    ]);

    // 获取更新后的积分
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { credits: true },
    });

    return NextResponse.json({
      success: true,
      creditsEarned: CHECKIN_CREDITS,
      totalCredits: user?.credits ?? 0,
      date: today.toISOString().split("T")[0],
    });
  } catch (error) {
    log.error("Checkin error:", error);
    return NextResponse.json({ error: "Failed to checkin" }, { status: 500 });
  }
}
