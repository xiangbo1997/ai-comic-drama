/**
 * 分镜生成版本历史 API（迭代式图片生成配套）
 *
 * GET   /api/scenes/[sceneId]/attempts        列出该分镜的所有历史生成版本（最新在前）
 * PATCH /api/scenes/[sceneId]/attempts { attemptId }  把某历史版本设为当前版本（回退/切换）
 *
 * 鉴权：分镜必须归属当前用户（scene.project.userId），否则 404（IDOR 防护，
 *      不泄露分镜是否存在）。切换版本不扣积分、不删除任何历史。
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:scenes:attempts");

/** 校验分镜归属当前用户；返回 true 表示有权访问 */
async function ownsScene(sceneId: string, userId: string): Promise<boolean> {
  const scene = await prisma.scene.findFirst({
    where: { id: sceneId, project: { userId } },
    select: { id: true },
  });
  return !!scene;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sceneId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { sceneId } = await params;

    if (!(await ownsScene(sceneId, session.user.id))) {
      return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
    }

    // 只列出真正出图的版本（outputUrl 非空），最新在前
    const attempts = await prisma.generationAttempt.findMany({
      where: { sceneId, outputUrl: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        attemptNumber: true,
        strategy: true,
        note: true,
        outputUrl: true,
        isCurrent: true,
        passedValidation: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ attempts });
  } catch (error) {
    log.error("List scene attempts error:", error);
    return NextResponse.json({ error: "获取版本历史失败" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sceneId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { sceneId } = await params;

    if (!(await ownsScene(sceneId, session.user.id))) {
      return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
    }

    const { attemptId } = await request.json();
    if (!attemptId || typeof attemptId !== "string") {
      return NextResponse.json(
        { error: "attemptId is required" },
        { status: 400 }
      );
    }

    // 目标版本必须属于该分镜且已出图
    const target = await prisma.generationAttempt.findFirst({
      where: { id: attemptId, sceneId, outputUrl: { not: null } },
      select: { id: true, outputUrl: true },
    });
    if (!target?.outputUrl) {
      return NextResponse.json({ error: "版本不存在" }, { status: 404 });
    }

    // 切换当前版本：旧版取消 isCurrent + 目标置 isCurrent + 回写 Scene.imageUrl
    // （Scene.imageUrl 仍是唯一真相，导出/视频/尾帧据此消费）。不扣积分、不删历史。
    await prisma.$transaction([
      prisma.generationAttempt.updateMany({
        where: { sceneId, isCurrent: true },
        data: { isCurrent: false },
      }),
      prisma.generationAttempt.update({
        where: { id: target.id },
        data: { isCurrent: true },
      }),
      prisma.scene.update({
        where: { id: sceneId },
        data: { imageUrl: target.outputUrl, imageStatus: "COMPLETED" },
      }),
    ]);

    return NextResponse.json({ imageUrl: target.outputUrl });
  } catch (error) {
    log.error("Switch scene version error:", error);
    return NextResponse.json({ error: "切换版本失败" }, { status: 500 });
  }
}
