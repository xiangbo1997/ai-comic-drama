import { auth } from "@/lib/auth";
import {
  getPresignedUploadUrl,
  isR2Configured,
  type FileType,
} from "@/services/storage";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:upload");

/** 合法的文件上传类型（含水印 logo） */
const ALLOWED_FILE_TYPES: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "watermark",
]);

/** watermark 类型仅允许 png/jpg/jpeg/webp */
const WATERMARK_ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

/** watermark 文件大小上限（2 MB，由前端在上传前校验；此处作二次限制说明） */
const WATERMARK_MAX_SIZE_BYTES = 2 * 1024 * 1024;

// 获取预签名上传 URL
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 503 }
      );
    }

    const { fileName, contentType, fileType, projectId, fileSize } =
      await request.json();

    if (!fileName || !contentType || !fileType) {
      return NextResponse.json(
        { error: "Missing required fields: fileName, contentType, fileType" },
        { status: 400 }
      );
    }

    if (!ALLOWED_FILE_TYPES.has(fileType)) {
      return NextResponse.json(
        {
          error: `Invalid fileType. Must be one of: ${[...ALLOWED_FILE_TYPES].join(", ")}`,
        },
        { status: 400 }
      );
    }

    // watermark 文件额外校验：类型必须是图片，文件大小不超过 2 MB
    if (fileType === "watermark") {
      if (!WATERMARK_ALLOWED_CONTENT_TYPES.has(contentType)) {
        return NextResponse.json(
          {
            error: "Watermark must be an image file (png, jpg, jpeg, webp)",
          },
          { status: 400 }
        );
      }
      if (fileSize !== undefined && fileSize > WATERMARK_MAX_SIZE_BYTES) {
        return NextResponse.json(
          { error: "Watermark file must be smaller than 2 MB" },
          { status: 400 }
        );
      }
    }

    // storage.ts 的 FileType 仅含 image/video/audio；
    // watermark 在存储层映射为 "image"，路径前缀不同由 fileName 区分
    const storageFileType: FileType =
      fileType === "watermark" ? "image" : (fileType as FileType);

    // watermark 文件名加前缀方便区分路径
    const resolvedFileName =
      fileType === "watermark" ? `watermark_${fileName}` : fileName;

    const result = await getPresignedUploadUrl({
      fileName: resolvedFileName,
      contentType,
      fileType: storageFileType,
      userId: session.user.id,
      projectId,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("Get presigned URL error:", error);
    return NextResponse.json(
      { error: "Failed to get upload URL" },
      { status: 500 }
    );
  }
}
