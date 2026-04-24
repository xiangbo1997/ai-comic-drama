import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:characters:[id]:images");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 删除指定索引的图片
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证角色归属
    const character = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 获取要删除的图片索引
    const { searchParams } = new URL(request.url);
    const index = searchParams.get("index");

    if (index === null) {
      return NextResponse.json(
        { error: "Index parameter required" },
        { status: 400 }
      );
    }

    const idx = parseInt(index, 10);

    if (isNaN(idx) || idx < 0 || idx >= character.referenceImages.length) {
      return NextResponse.json({ error: "Invalid index" }, { status: 400 });
    }

    // 删除指定索引的图片
    const newImages = character.referenceImages.filter((_, i) => i !== idx);

    const updatedCharacter = await prisma.character.update({
      where: { id },
      data: { referenceImages: newImages },
    });

    return NextResponse.json(updatedCharacter);
  } catch (error) {
    log.error("Delete image error:", error);
    return NextResponse.json(
      { error: "Failed to delete image" },
      { status: 500 }
    );
  }
}
