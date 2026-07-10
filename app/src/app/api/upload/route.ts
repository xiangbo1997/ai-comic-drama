import { auth } from "@/lib/auth";
import {
  getPresignedUploadUrl,
  uploadToLocal,
  uploadToR2,
  isR2Configured,
  isStorageConfigured,
  type FileType,
} from "@/services/storage";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:upload");

/**
 * 校验 projectId（若提供）归属当前用户，防 IDOR：
 * 用户不能把文件挂到他人的 projectId 路径下污染存储组织结构。
 * 返回 true 表示通过（未提供 projectId 视为通过）。
 */
async function assertProjectOwnership(
  projectId: string | undefined,
  userId: string
): Promise<boolean> {
  if (!projectId) return true;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  return Boolean(project);
}

/**
 * 各 fileType 的 content-type 白名单 + 大小上限。
 *
 * 安全：原版仅 watermark 做校验，image/video/audio 裸奔——可传 SVG/HTML
 * 当图片造成存储型 XSS，或超大文件耗尽磁盘 DoS（security-cost P0-3）。
 * 注意：image 白名单**刻意排除 svg**（SVG 可内嵌脚本，是存储型 XSS 载体）。
 */
const UPLOAD_RULES: Record<
  string,
  { types: ReadonlySet<string>; maxBytes: number; label: string }
> = {
  image: {
    types: new Set([
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/gif",
    ]),
    maxBytes: 15 * 1024 * 1024, // 15 MB
    label: "图片（png/jpeg/webp/gif，不含 svg）",
  },
  watermark: {
    types: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
    maxBytes: 2 * 1024 * 1024, // 2 MB
    label: "水印图片（png/jpeg/webp）",
  },
  video: {
    types: new Set([
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
    ]),
    maxBytes: 200 * 1024 * 1024, // 200 MB
    label: "视频（mp4/webm/mov/avi）",
  },
  audio: {
    types: new Set([
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/aac",
      "audio/ogg",
    ]),
    maxBytes: 30 * 1024 * 1024, // 30 MB（配乐/配音）
    label: "音频（mp3/wav/m4a/aac/ogg）",
  },
};

/** 校验 fileType + content-type 白名单 + 大小上限；不通过返回错误，通过返回 null */
function validateUpload(params: {
  fileType: string;
  contentType: string;
  fileSize?: number;
}): string | null {
  const { fileType, contentType, fileSize } = params;

  const rule = UPLOAD_RULES[fileType];
  if (!rule) {
    return `Invalid fileType. Must be one of: ${Object.keys(UPLOAD_RULES).join(", ")}`;
  }

  // content-type 必须命中白名单（防 SVG/HTML 伪装等存储型 XSS 载体）
  if (!rule.types.has(contentType.toLowerCase())) {
    return `不支持的文件类型，需为${rule.label}`;
  }

  // 大小上限（防磁盘 DoS）。fileSize 由前端/multipart 提供；
  // multipart 直传时是服务端读到的真实大小，可靠。
  if (fileSize !== undefined && fileSize > rule.maxBytes) {
    return `文件过大，${rule.label}上限 ${Math.round(rule.maxBytes / 1024 / 1024)} MB`;
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

      const resolvedProjectId = projectId ? String(projectId) : undefined;
      if (!(await assertProjectOwnership(resolvedProjectId, userId))) {
        return NextResponse.json({ error: "无权访问该项目" }, { status: 403 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const storageOptions = {
        fileName: toResolvedFileName(fileType, file.name),
        contentType: file.type,
        fileType: toStorageFileType(fileType),
        userId,
        projectId: resolvedProjectId,
      };
      // 配了 R2 → 服务端中转到 R2（服务器持对象写 token，不涉浏览器跨域，
      // 规避 bucket 未配 CORS 导致的前端直传 PUT 被拦）；否则落本地盘。
      const fileUrl = isR2Configured()
        ? await uploadToR2(buffer, storageOptions)
        : await uploadToLocal(buffer, storageOptions);

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

    if (
      !(await assertProjectOwnership(
        projectId ? String(projectId) : undefined,
        userId
      ))
    ) {
      return NextResponse.json({ error: "无权访问该项目" }, { status: 403 });
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
