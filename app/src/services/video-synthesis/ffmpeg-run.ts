/**
 * 视频合成 —— FFmpeg 进程执行与 URL/下载工具
 *
 * 从 services/video-synthesis.ts 原样提取（零行为变更）：spawn 执行封装、
 * path-only URL 绝对化、SSRF 防护下载。供主文件与 media-ops 共用。
 */

import { spawn } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { safeDownload } from "@/lib/url-guard";

/**
 * 把 path-only URL（如 /uploads/...）补全成绝对 URL
 * 与 openai-compatible.ts / flow2api-video.ts 保持一致逻辑
 */
export function absolutizeUrl(url: string): string {
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

// SSRF 防护（assertSafeUrl / isPrivateOrReservedIp）已提取到 @/lib/url-guard，
// 供 video-synthesis / storage / ai 测试端点等所有出站 fetch 复用。

/**
 * 下载远程文件到指定的临时目录。
 *
 * tmpDir 必传且必须是「每次导出独占」的目录：文件名是 video_${order}.mp4 /
 * bgm_track.mp3 这类固定名，此前所有导出共用 os.tmpdir()/ai-comic-export，
 * 两个并发导出会互相覆盖素材（跨租户内容串台），且该父目录从不清理、只泄漏。
 * 传入 synthesizeVideo 的 per-run 目录后，既天然隔离，也被 finally 的 rm 覆盖。
 */
export async function downloadFile(
  url: string,
  filename: string,
  tmpDir: string
): Promise<string> {
  if (!existsSync(tmpDir)) {
    await mkdir(tmpDir, { recursive: true });
  }

  const filePath = path.join(tmpDir, filename);
  const absoluteUrl = absolutizeUrl(url);
  // SSRF 防护：钉 IP 下载（校验与连接同一地址，防 TOCTOU / 重定向绕过）
  const { buffer } = await safeDownload(absoluteUrl);
  await writeFile(filePath, buffer);

  return filePath;
}

/**
 * 所有导出与媒体操作共用单路队列，避免多个请求叠加FFmpeg内存拖死HTTP服务。
 */
let ffmpegActive = false;
const ffmpegWaiters: Array<() => void> = [];

function limitFFmpegThreads(args: string[]): string[] {
  if (!args.length || args.at(-1)?.startsWith("-")) return [...args];
  const bounded: string[] = [];
  for (const flag of ["-filter_threads", "-filter_complex_threads"]) {
    if (!args.includes(flag)) bounded.push(flag, "1");
  }
  let groupStart = 0;
  args.forEach((arg, index) => {
    if (arg === "-i") {
      if (!args.slice(groupStart, index).includes("-threads")) {
        bounded.push("-threads", "1");
      }
      groupStart = index + 2;
    }
    if (
      index === args.length - 1 &&
      !args.slice(groupStart).includes("-threads")
    ) {
      bounded.push("-threads", "2");
    }
    bounded.push(arg);
  });
  return bounded;
}

export function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = () => {
      ffmpegActive = true;
      let settled = false;
      const finish = (error?: Error) => {
        // 启动失败可能先发error再发close，只能释放一次并发额度。
        if (settled) return;
        settled = true;
        ffmpegActive = false;
        if (error) reject(error);
        else resolve();
        ffmpegWaiters.shift()?.();
      };
      try {
        const ffmpeg = spawn("ffmpeg", limitFFmpegThreads(args));

        let stderr = "";
        ffmpeg.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        ffmpeg.on("close", (code, signal) => {
          if (code === 0) {
            finish();
          } else {
            const reason = signal
              ? `terminated by signal ${signal}`
              : `exited with code ${code}`;
            finish(new Error(`FFmpeg ${reason}: ${stderr}`));
          }
        });

        ffmpeg.on("error", (err) => {
          finish(err);
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    if (ffmpegActive) ffmpegWaiters.push(start);
    else start();
  });
}
