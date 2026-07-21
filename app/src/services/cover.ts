/**
 * 平台竖屏封面合成服务（红果/抖音审核链条覆盖封面）。
 *
 * 确定性合成（零 AI 成本）：已有图（分镜图 / 主角定妆图）做底 + 中文大字剧名。
 * 走 ffmpeg 单帧输出 + ASS 烧字（与批6 片头卡同一条文字管道，字体经 fontsdir
 * 钉到仓库 fonts/ 目录，中文字形可控）。产物统一走 storage.uploadFile() 门面
 * （R2/本地盘自动降级），返回可访问 URL。
 *
 * 底图来源必须已由 lib/cover.resolveCoverSource 过白名单（本项目分镜 imageUrl ∪
 * 关联角色定妆图），下载走 lib/url-guard.safeDownload（钉 IP 防 SSRF）。
 * 封面文字由 lib/cover.buildCoverAss 组装（纯函数，复用 CARD_STYLE 单一真源）。
 */

import { spawn } from "child_process";
import { writeFile, unlink, mkdir, readFile, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";

import { safeDownload } from "@/lib/url-guard";
import { uploadFile } from "@/services/storage";
import {
  buildCoverAss,
  resolveCoverText,
  COVER_WIDTH,
  COVER_HEIGHT,
  type ResolveCoverTextInput,
} from "@/lib/cover";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:cover");

/** generateProjectCover 入参 */
export interface GenerateProjectCoverInput {
  /** 项目 id（落盘路径 + 日志） */
  projectId: string;
  /** 用户 id（存储路径归属） */
  userId: string;
  /** 已过白名单的底图 URL（本项目分镜图 / 主角定妆图） */
  sourceUrl: string;
  /** 封面文字解析入参（项目名 / 集数 / 用户自定义标题副题） */
  text: ResolveCoverTextInput;
}

/** 把 path-only URL（/uploads/...）补成绝对 URL（与 video-synthesis 一致） */
function absolutizeUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://comic.cloudsentryai.com";
  const trimmedBase = base.replace(/\/+$/, "");
  const p = url.startsWith("/") ? url : `/${url}`;
  return `${trimmedBase}${p}`;
}

/** 执行 ffmpeg（与 video-synthesis 同构：收集 stderr，非 0 退出抛错） */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
      }
    });
    ffmpeg.on("error", reject);
  });
}

/** 转义 ffmpeg filter 中的文件路径（与 buildSubtitleFilter 一致） */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

/**
 * 合成平台竖屏封面并上传，返回封面 URL。
 *
 * 滤镜链（单帧）：
 *   scale=1080:1920:force_original_aspect_ratio=increase  底图放大到「覆盖」画布
 *   crop=1080:1920                                          居中裁剪充满（cover 语义）
 *   eq=brightness=-0.06:saturation=1.05                     轻微压暗 + 微提饱和，保白字可读、显精神
 *   subtitles='<cover.ass>':fontsdir='<fonts/>'             烧中文大字标题（得意黑）
 *   -frames:v 1 -q:v 2                                      输出单帧高质量 JPEG（q:v 2 ≈ 质量 90+）
 *
 * @throws ffmpeg 失败 / 产物为空时抛可读错误（调用方转 HTTP 500，给用户提示）
 */
export async function generateProjectCover(
  input: GenerateProjectCoverInput
): Promise<string> {
  const resolved = resolveCoverText(input.text);

  const tmpDir = path.join(
    os.tmpdir(),
    "ai-comic-cover",
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  await mkdir(tmpDir, { recursive: true });

  const basePath = path.join(tmpDir, "base");
  const assPath = path.join(tmpDir, "cover.ass");
  const outputPath = path.join(tmpDir, "cover.jpg");

  try {
    // 1. 下载底图（钉 IP 防 SSRF；URL 已过白名单）
    let buffer: Buffer;
    try {
      const dl = await safeDownload(absolutizeUrl(input.sourceUrl));
      buffer = dl.buffer;
    } catch (err) {
      log.error(`封面底图下载失败 (project=${input.projectId}):`, err);
      throw new Error("封面底图下载失败，请稍后重试");
    }
    await writeFile(basePath, buffer);

    // 2. 写封面 ASS（大字标题 + 可选副题）
    await writeFile(assPath, buildCoverAss(resolved), "utf-8");

    // 3. ffmpeg 单帧合成：cover 充满 + 轻压暗 + 烧字 → 高质量 JPEG
    const escapedAss = escapeFilterPath(assPath);
    const fontsDir = escapeFilterPath(path.join(process.cwd(), "fonts"));
    const vf = [
      `scale=${COVER_WIDTH}:${COVER_HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${COVER_WIDTH}:${COVER_HEIGHT}`,
      `eq=brightness=-0.06:saturation=1.05`,
      `subtitles='${escapedAss}':fontsdir='${fontsDir}'`,
    ].join(",");

    await runFFmpeg([
      "-i",
      basePath,
      "-vf",
      vf,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-y",
      outputPath,
    ]);

    // 4. 读产物并校验非空
    if (!existsSync(outputPath)) {
      throw new Error("封面合成失败：ffmpeg 未产出文件");
    }
    const coverBuffer = await readFile(outputPath);
    if (coverBuffer.length === 0) {
      throw new Error("封面合成失败：产物为空");
    }

    // 5. 上传（R2/本地盘自动降级），返回可访问 URL
    const coverUrl = await uploadFile(coverBuffer, {
      fileName: `cover_${Date.now()}.jpg`,
      contentType: "image/jpeg",
      fileType: "image",
      userId: input.userId,
      projectId: input.projectId,
    });

    // 单独清理已上传的中间文件（finally 里 rm 整目录做兜底）
    await unlink(basePath).catch(() => {});
    return coverUrl;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
