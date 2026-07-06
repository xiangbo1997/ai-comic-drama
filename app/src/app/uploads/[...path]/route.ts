/**
 * 本地存储文件服务路由（/uploads/**）。
 *
 * 背景：Next.js 16 生产模式（next start）在启动时对 public/ 目录做快照，
 * 运行时新写入 public/uploads 的文件不在快照内，静态层直接 404，
 * 导致「图片生成成功、落库成功，但页面不显示」——必须重启服务才恢复。
 *
 * 方案：public 静态层命中不了的 /uploads/* 请求会落到本路由，
 * 由本路由在请求时实时读磁盘返回。旧文件仍由静态层服务（优先级更高），
 * 新文件由本路由兜底；重启后新文件进入快照，自动回到静态层。
 *
 * 安全：路径经 resolve 归一化并强制落在存储根目录内，阻断 ../ 穿越；
 * 不做鉴权——与 public/uploads 原有暴露面一致（URL 含 userId + 时间戳，不可枚举）。
 */

import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import path from "path";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// 与 services/storage.ts 保持同一约定（默认 public/uploads）
const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || "public/uploads";

const MIME_BY_EXT: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
};

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

/** 解析并校验目标文件路径；非法或越界返回 null。 */
function resolveSafePath(segments: string[]): string | null {
  if (!segments.length) return null;
  const baseDir = path.resolve(process.cwd(), LOCAL_STORAGE_DIR);
  const target = path.resolve(baseDir, segments.join("/"));
  // 归一化后必须仍在存储根目录内（防 ../ 穿越）
  if (target !== baseDir && !target.startsWith(baseDir + path.sep)) {
    return null;
  }
  return target;
}

function contentTypeOf(filePath: string): string {
  return (
    MIME_BY_EXT[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

/** 解析 Range 头（仅支持单区间 bytes=start-end）。 */
function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  // bytes=-N 表示末尾 N 字节
  const start =
    rawStart === "" ? Math.max(0, size - Number(rawEnd)) : Number(rawStart);
  const end =
    rawStart !== "" && rawEnd !== ""
      ? Math.min(Number(rawEnd), size - 1)
      : size - 1;
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start > end ||
    start >= size
  ) {
    return null;
  }
  return { start, end };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { path: segments } = await params;
  const filePath = resolveSafePath(segments);
  if (!filePath) {
    return new Response("Not Found", { status: 404 });
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  if (!fileStat.isFile()) {
    return new Response("Not Found", { status: 404 });
  }

  const baseHeaders: Record<string, string> = {
    "Content-Type": contentTypeOf(filePath),
    "Accept-Ranges": "bytes",
    // 文件名含时间戳、内容不变，可长缓存
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  const range = parseRange(request.headers.get("range"), fileStat.size);
  if (range) {
    const stream = createReadStream(filePath, {
      start: range.start,
      end: range.end,
    });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${fileStat.size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }

  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(fileStat.size),
    },
  });
}

export async function HEAD(request: NextRequest, ctx: RouteParams) {
  const res = await GET(request, ctx);
  // HEAD 只回头部；主动取消底层流避免文件句柄泄漏
  void res.body?.cancel().catch(() => {});
  return new Response(null, { status: res.status, headers: res.headers });
}
