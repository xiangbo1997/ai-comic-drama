import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:tags:[id]");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 更新标签
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 检查标签是否存在且属于用户
    const existingTag = await prisma.tag.findUnique({
      where: { id },
    });

    if (!existingTag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    // 系统预设标签不能修改
    if (existingTag.isSystem) {
      return NextResponse.json(
        { error: "系统预设标签不能修改" },
        { status: 403 }
      );
    }

    // 用户只能修改自己的标签
    if (existingTag.userId !== session.user.id) {
      return NextResponse.json({ error: "无权修改此标签" }, { status: 403 });
    }

    const { name, category, color } = await request.json();

    // 如果修改名称，检查是否与其他标签重名
    if (name && name.trim() !== existingTag.name) {
      const duplicateTag = await prisma.tag.findFirst({
        where: {
          name: name.trim(),
          id: { not: id },
          OR: [{ isSystem: true }, { userId: session.user.id }],
        },
      });

      if (duplicateTag) {
        return NextResponse.json({ error: "标签名称已存在" }, { status: 400 });
      }
    }

    const tag = await prisma.tag.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(category !== undefined && { category }),
        ...(color !== undefined && { color }),
      },
    });

    return NextResponse.json(tag);
  } catch (error) {
    log.error("Update tag error:", error);
    return NextResponse.json(
      { error: "Failed to update tag" },
      { status: 500 }
    );
  }
}

// 删除标签
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 检查标签是否存在
    const existingTag = await prisma.tag.findUnique({
      where: { id },
    });

    if (!existingTag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    // 系统预设标签不能删除
    if (existingTag.isSystem) {
      return NextResponse.json(
        { error: "系统预设标签不能删除" },
        { status: 403 }
      );
    }

    // 用户只能删除自己的标签
    if (existingTag.userId !== session.user.id) {
      return NextResponse.json({ error: "无权删除此标签" }, { status: 403 });
    }

    // 删除标签（关联的 CharacterTag 会自动级联删除）
    await prisma.tag.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete tag error:", error);
    return NextResponse.json(
      { error: "Failed to delete tag" },
      { status: 500 }
    );
  }
}
