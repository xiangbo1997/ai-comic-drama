import { auth } from "@/lib/auth";
import {
  getPresignedUploadUrl,
  uploadToLocal,
  isR2Configured,
  isStorageConfigured,
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

/** 校验 fileType / watermark 专属约束；不通过返回错误字符串，通过返回 null */
function validateUpload(params: {
  fileType: string;
  contentType: string;
  fileSize?: number;
}): string | null {
  const { fileType, contentType, fileSize } = params;

  if (!ALLOWED_FILE_TYPES.has(fileType)) {
    return `Invalid fileType. Must be one of: ${[...ALLOWED_FILE_TYPES].join(", ")}`;
  }

  // watermark 文件额外校验：类型必须是图片，文件大小不超过 2 MB
  if (fileType === "watermark") {
    if (!WATERMARK_ALLOWED_CONTENT_TYPES.has(contentType)) {
      return "Watermark must be an image file (png, jpg, jpeg, webp)";
    }
    if (fileSize !== undefined && fileSize > WATERMARK_MAX_SIZE_BYTES) {
      return "Watermark file must be smaller than 2 MB";
    }
  }

  return null;
}

/**
 * storage.ts 的 FileType 仅含 image/video/audio；
 * watermark 在存储层映射为 "image"，靠文件名前缀区分路径。
 */
function toStorageFileType(fileType: string): FileType {
  return fileType === "watermark" ? "image" : (fileType as FileType);
}

/** watermark 文件名加前缀方便区分路径 */
function toResolvedFileName(fileType: string, fileName: string): string {
  return fileType === "watermark" ? `watermark_${fileName}` : fileName;
}

/**
 * 文件上传端点（双模式，按请求 Content-Type 分派）：
 *
 * 1. application/json —— 请求上传凭证。
 *    - R2 已配置：返回 { uploadUrl, fileUrl }，前端二段式 PUT 直传 R2（零服务端中转）。
 *    - R2 未配置但本地存储可用：返回 { direct: true }，提示前端改用 multipart 直传
 *      （本地磁盘无"预签名 URL"概念，必须一段式 POST 给服务端写盘）。
 *    - 任何存储都不可用：503。
 *
 * 2. multipart/form-data —— 直接携带文件，服务端写入本地存储后返回 { fileUrl }。
 *    字段：file（必需）、fileType（必需）、projectId（可选）。
 *
 * 两种存储后端切换时前端代码无需改动：仅由 isR2Configured() 决定走哪条路。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 503 }
      );
    }

    const userId = session.user.id;
    const requestContentType = request.headers.get("content-type") ?? "";

    // ---- 模式二：multipart 直传（本地存储一段式） ----
    if (requestContentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      const fileType = String(formData.get("fileType") ?? "");
      const projectId = formData.get("projectId");

      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "Missing file in form-data" },
          { status: 400 }
        );
      }

      const validationError = validateUpload({
        fileType,
        contentType: file.type,
        fileSize: file.size,
      });
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileUrl = await uploadToLocal(buffer, {
        fileName: toResolvedFileName(fileType, file.name),
        contentType: file.type,
        fileType: toStorageFileType(fileType),
        userId,
        projectId: projectId ? String(projectId) : undefined,
      });

      return NextResponse.json({ fileUrl });
    }

    // ---- 模式一：JSON 求上传凭证 ----
    const { fileName, contentType, fileType, projectId, fileSize } =
      await request.json();

    if (!fileName || !contentType || !fileType) {
      return NextResponse.json(
        { error: "Missing required fields: fileName, contentType, fileType" },
        { status: 400 }
      );
    }

    const validationError = validateUpload({ fileType, contentType, fileSize });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // R2 未配置 → 提示前端改用 multipart 直传（走本地存储）
    if (!isR2Configured()) {
      return NextResponse.json({ direct: true });
    }

    const result = await getPresignedUploadUrl({
      fileName: toResolvedFileName(fileType, fileName),
      contentType,
      fileType: toStorageFileType(fileType),
      userId,
      projectId,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
