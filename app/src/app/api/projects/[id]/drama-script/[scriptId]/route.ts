import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:drama-script:[scriptId]");

interface RouteParams {
  params: Promise<{ id: string; scriptId: string }>;
}

// 创作者打磨：允许改元信息与脚本主体，version 自增
const PatchSchema = z.object({
  filmTitle: z.string().trim().max(200).optional(),
  genre: z.string().trim().max(100).optional(),
  durationSec: z.number().int().min(10).max(600).optional(),
  aspectRatio: z.string().max(20).optional(),
  style: z.string().max(50).optional(),
  protagonist: z.string().max(4000).optional(),
  worldview: z.string().max(8000).optional(),
  scriptDoc: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 校验脚本归属（脚本属于该项目，且项目属于当前用户）。
 * 返回 scriptId 或 null（无权/不存在）。
 */
async function assertOwnership(
  userId: string,
  projectId: string,
  scriptId: string
): Promise<boolean> {
  const script = await prisma.shortDramaScript.findFirst({
    where: {
      id: scriptId,
      projectId,
      project: { userId },
    },
    select: { id: true },
  });
  return !!script;
}

/**
 * PATCH /api/projects/[id]/drama-script/[scriptId]
 * 创作者手动打磨脚本任意字段，version++。
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { id, scriptId } = await params;

    if (!(await assertOwnership(session.user.id, id, scriptId))) {
      return NextResponse.json({ error: "脚本不存在" }, { status: 404 });
    }

    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求参数无效", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const updated = await prisma.shortDramaScript.update({
      where: { id: scriptId },
      data: {
        ...(data.filmTitle !== undefined && { filmTitle: data.filmTitle }),
        ...(data.genre !== undefined && { genre: data.genre }),
        ...(data.durationSec !== undefined && {
          durationSec: data.durationSec,
        }),
        ...(data.aspectRatio !== undefined && {
          aspectRatio: data.aspectRatio,
        }),
        ...(data.style !== undefined && { style: data.style }),
        ...(data.protagonist !== undefined && {
          protagonist: data.protagonist,
        }),
        ...(data.worldview !== undefined && { worldview: data.worldview }),
        ...(data.scriptDoc !== undefined && {
          scriptDoc: JSON.parse(JSON.stringify(data.scriptDoc)),
        }),
        version: { increment: 1 },
      },
    });

    return NextResponse.json({ script: updated });
  } catch (error) {
    log.error("Drama script PATCH error:", error);
    return NextResponse.json({ error: "更新脚本失败" }, { status: 500 });
  }
}
