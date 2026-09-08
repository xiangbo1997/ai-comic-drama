import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { deleteFile } from "@/services/storage";

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

    // 验证角色归属；同时取 canonicalImageUrl 与 referenceAssets，
    // 用于判断被移除的 URL 是否仍被别处引用（引用中则只摘数组不删文件）
    const character = await prisma.character.findFirst({
      where: { id, userId: session.user.id },
      include: { referenceAssets: { select: { url: true } } },
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
    const removedUrl = character.referenceImages[idx];
    const newImages = character.referenceImages.filter((_, i) => i !== idx);

    const updatedCharacter = await prisma.character.update({
      where: { id },
      data: { referenceImages: newImages },
    });

    // 摘出数组后同步删存储文件，否则每次删图都留一个永久孤儿。
    // 仅当该 URL 不再被本角色的任何字段引用时才真删：数组里可能重复、
    // 也可能同时是定妆锚 canonicalImageUrl 或某条 referenceAsset 的 url，
    // 那些位置仍要能取到图。跨角色共享无从廉价判断，此处不覆盖（假设：
    // 参考图上传/生成都按角色独立落盘，不共享 URL）。
    const stillReferenced =
      newImages.includes(removedUrl) ||
      character.canonicalImageUrl === removedUrl ||
      character.referenceAssets.some((a) => a.url === removedUrl);

    if (removedUrl && !stillReferenced) {
      void deleteFile(removedUrl).catch((error) => {
        log.warn(`角色 ${id} 删除参考图后清理存储失败（孤儿）:`, error);
      });
    }

    return NextResponse.json(updatedCharacter);
  } catch (error) {
    log.error("Delete image error:", error);
    return NextResponse.json(
      { error: "Failed to delete image" },
      { status: 500 }
    );
  }
}
