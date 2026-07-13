/**
 * PATCH /api/projects/[id]/locations/[locationId]
 *
 * 更新地点行（计划 §5 · 2.2）：
 *  - description：用户改环境描述（草稿态审改）。
 *  - imageUrl：上传替换流——客户端先经 /api/upload 传图拿到 URL，再 PATCH 该 URL。
 *
 * URL 校验：与商标水印 imageUrl 一致，接受 app 自有上传 URL 原样（R2 或本地
 * /uploads/*），仅做长度上限（≤2048）校验，不强制 http(s) 绝对 URL——本地降级
 * 存储返回的是相对路径 /uploads/...。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const log = createLogger("api:projects:locations:[locationId]");

interface RouteParams {
  params: Promise<{ id: string; locationId: string }>;
}

const PatchSchema = z
  .object({
    description: z.string().max(500).nullable().optional(),
    imageUrl: z.string().max(2048).nullable().optional(),
  })
  .refine((v) => v.description !== undefined || v.imageUrl !== undefined, {
    message: "至少提供 description 或 imageUrl 之一",
  });

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id, locationId } = await params;

    const parsed = PatchSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "参数错误" },
        { status: 400 }
      );
    }

    // 校验：项目归属 + 地点行属本项目（防越权改他人地点）
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const location = await prisma.projectLocation.findFirst({
      where: { id: locationId, projectId: id },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    const data: { description?: string | null; imageUrl?: string | null } = {};
    if (parsed.data.description !== undefined) {
      const d = parsed.data.description?.trim() ?? null;
      data.description = d || null;
    }
    if (parsed.data.imageUrl !== undefined) {
      const u = parsed.data.imageUrl?.trim() ?? null;
      data.imageUrl = u || null;
    }

    const updated = await prisma.projectLocation.update({
      where: { id: locationId },
      data,
      select: {
        id: true,
        locationKey: true,
        description: true,
        imageUrl: true,
      },
    });

    return NextResponse.json({ location: updated });
  } catch (error) {
    log.error("Update location error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新场景地点失败" },
      { status: 500 }
    );
  }
}
