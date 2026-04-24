/**
 * 文件存储服务
 * 支持 Cloudflare R2 和本地存储
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs/promises";
import path from "path";

import { createLogger } from "@/lib/logger";
const log = createLogger("services:storage");

// R2 客户端配置
const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "ai-comic-drama";
const PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

export type FileType = "image" | "video" | "audio";

interface UploadOptions {
  fileName: string;
  contentType: string;
  fileType: FileType;
  userId: string;
  projectId?: string;
}

// 生成文件路径
function generateFilePath(options: UploadOptions): string {
  const { fileType, userId, projectId, fileName } = options;
  const timestamp = Date.now();
  const ext = fileName.split(".").pop() || "";
  const baseName = fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, "_");

  if (projectId) {
    return `${userId}/${projectId}/${fileType}s/${timestamp}_${baseName}.${ext}`;
  }
  return `${userId}/${fileType}s/${timestamp}_${baseName}.${ext}`;
}

// 上传文件到 R2
export async function uploadToR2(
  buffer: Buffer,
  options: UploadOptions
): Promise<string> {
  const filePath = generateFilePath(options);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filePath,
    Body: buffer,
    ContentType: options.contentType,
  });

  await r2Client.send(command);

  // 返回公开 URL
  if (PUBLIC_URL) {
    return `${PUBLIC_URL}/${filePath}`;
  }

  // 如果没有公开 URL，返回签名 URL
  return getSignedUrl(r2Client, new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filePath,
  }), { expiresIn: 3600 * 24 * 7 }); // 7天有效期
}

// 从 URL 上传文件到 R2
export async function uploadFromUrl(
  url: string,
  options: UploadOptions
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file from URL: ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return uploadToR2(buffer, options);
}

// 删除 R2 文件
export async function deleteFromR2(fileUrl: string): Promise<void> {
  // 从 URL 提取文件路径
  let filePath: string;

  if (PUBLIC_URL && fileUrl.startsWith(PUBLIC_URL)) {
    filePath = fileUrl.replace(`${PUBLIC_URL}/`, "");
  } else {
    // 尝试从签名 URL 提取
    const url = new URL(fileUrl);
    filePath = url.pathname.slice(1); // 移除开头的 /
  }

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filePath,
  });

  await r2Client.send(command);
}

// 生成预签名上传 URL
export async function getPresignedUploadUrl(
  options: UploadOptions
): Promise<{ uploadUrl: string; fileUrl: string }> {
  const filePath = generateFilePath(options);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filePath,
    ContentType: options.contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });

  const fileUrl = PUBLIC_URL
    ? `${PUBLIC_URL}/${filePath}`
    : await getSignedUrl(r2Client, new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
      }), { expiresIn: 3600 * 24 * 7 });

  return { uploadUrl, fileUrl };
}

// 检查 R2 是否配置
export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  );
}

// ============ 本地存储 ============

// 本地存储目录（相对于项目根目录）
const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || "public/uploads";
const LOCAL_STORAGE_URL_PREFIX = process.env.LOCAL_STORAGE_URL_PREFIX || "/uploads";

// 确保目录存在
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// 生成本地文件路径
function generateLocalFilePath(options: UploadOptions): { filePath: string; urlPath: string } {
  const { fileType, userId, projectId, fileName } = options;
  const timestamp = Date.now();
  const ext = fileName.split(".").pop() || "webp";
  const baseName = fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const finalFileName = `${timestamp}_${baseName}.${ext}`;

  let relativePath: string;
  if (projectId) {
    relativePath = `${userId}/${projectId}/${fileType}s/${finalFileName}`;
  } else {
    relativePath = `${userId}/${fileType}s/${finalFileName}`;
  }

  return {
    filePath: path.join(process.cwd(), LOCAL_STORAGE_DIR, relativePath),
    urlPath: `${LOCAL_STORAGE_URL_PREFIX}/${relativePath}`,
  };
}

// 上传文件到本地存储
export async function uploadToLocal(
  buffer: Buffer,
  options: UploadOptions
): Promise<string> {
  const { filePath, urlPath } = generateLocalFilePath(options);

  // 确保目录存在
  await ensureDir(path.dirname(filePath));

  // 写入文件
  await fs.writeFile(filePath, buffer);

  return urlPath;
}

// 从 URL 下载并保存到本地
export async function uploadFromUrlToLocal(
  url: string,
  options: UploadOptions
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file from URL: ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return uploadToLocal(buffer, options);
}

// 删除本地文件
export async function deleteFromLocal(fileUrl: string): Promise<void> {
  // 从 URL 提取文件路径
  const relativePath = fileUrl.replace(LOCAL_STORAGE_URL_PREFIX, "");
  const filePath = path.join(process.cwd(), LOCAL_STORAGE_DIR, relativePath);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    log.error("Failed to delete local file:", error);
  }
}

// 检查本地存储是否启用
export function isLocalStorageEnabled(): boolean {
  // 如果没有配置 R2，默认使用本地存储
  return process.env.USE_LOCAL_STORAGE === "true" || !isR2Configured();
}

// ============ 统一存储接口 ============

// 统一上传接口：优先 R2，降级到本地
export async function uploadFile(
  buffer: Buffer,
  options: UploadOptions
): Promise<string> {
  if (isR2Configured()) {
    return uploadToR2(buffer, options);
  }
  return uploadToLocal(buffer, options);
}

// 统一从 URL 上传接口
export async function uploadFileFromUrl(
  url: string,
  options: UploadOptions
): Promise<string> {
  if (isR2Configured()) {
    return uploadFromUrl(url, options);
  }
  return uploadFromUrlToLocal(url, options);
}

// 统一删除接口
export async function deleteFile(fileUrl: string): Promise<void> {
  if (fileUrl.startsWith(LOCAL_STORAGE_URL_PREFIX) || fileUrl.startsWith("/uploads")) {
    return deleteFromLocal(fileUrl);
  }
  if (isR2Configured()) {
    return deleteFromR2(fileUrl);
  }
}

// 检查是否有任何存储可用
export function isStorageConfigured(): boolean {
  return isR2Configured() || isLocalStorageEnabled();
}
