/**
 * 视频合成服务
 * 使用 FFmpeg 将多个分镜合成为完整视频
 */

import { spawn } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";

export interface SceneMedia {
  id: string;
  order: number;
  duration: number;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  dialogue?: string | null;
  narration?: string | null;
}

export interface ExportOptions {
  format: "mp4" | "webm";
  quality: "480p" | "720p" | "1080p";
  aspectRatio: "9:16" | "16:9" | "1:1";
  includeSubtitles: boolean;
  includeAudio: boolean;
}

const QUALITY_SETTINGS = {
  "480p": { width: 480, height: 854, bitrate: "1M" },
  "720p": { width: 720, height: 1280, bitrate: "2.5M" },
  "1080p": { width: 1080, height: 1920, bitrate: "5M" },
};

const ASPECT_RATIOS = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

/**
 * 把 path-only URL（如 /uploads/...）补全成绝对 URL
 * 与 openai-compatible.ts / flow2api-video.ts 保持一致逻辑
 */
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

/**
 * 下载远程文件到本地临时目录
 */
async function downloadFile(url: string, filename: string): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), "ai-comic-export");
  if (!existsSync(tmpDir)) {
    await mkdir(tmpDir, { recursive: true });
  }

  const filePath = path.join(tmpDir, filename);
  const absoluteUrl = absolutizeUrl(url);
  const response = await fetch(absoluteUrl);
  if (!response.ok) {
    throw new Error(`下载失败 (HTTP ${response.status}): ${absoluteUrl}`);
  }
  const buffer = await response.arrayBuffer();
  await writeFile(filePath, Buffer.from(buffer));

  return filePath;
}

/**
 * 生成 SRT 字幕文件
 */
async function generateSubtitleFile(
  scenes: SceneMedia[],
  outputPath: string
): Promise<string> {
  let srtContent = "";
  let index = 1;
  let currentTime = 0;

  for (const scene of scenes) {
    const text = scene.dialogue || scene.narration;
    if (text) {
      const startTime = formatSrtTime(currentTime);
      const endTime = formatSrtTime(currentTime + scene.duration);

      srtContent += `${index}\n`;
      srtContent += `${startTime} --> ${endTime}\n`;
      srtContent += `${text}\n\n`;
      index++;
    }
    currentTime += scene.duration;
  }

  const srtPath = path.join(outputPath, "subtitles.srt");
  await writeFile(srtPath, srtContent, "utf-8");
  return srtPath;
}

/**
 * 格式化 SRT 时间
 */
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

/**
 * 执行 FFmpeg 命令
 */
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

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * 将单个分镜转换为视频片段
 */
async function sceneToVideoClip(
  scene: SceneMedia,
  outputDir: string,
  options: ExportOptions
): Promise<string> {
  const { width, height } = ASPECT_RATIOS[options.aspectRatio];
  const outputPath = path.join(outputDir, `scene_${scene.order}.mp4`);

  // 如果有视频，直接使用
  if (scene.videoUrl) {
    const videoPath = await downloadFile(
      scene.videoUrl,
      `video_${scene.order}.mp4`
    );

    // 调整视频时长和尺寸
    await runFFmpeg([
      "-i",
      videoPath,
      "-t",
      scene.duration.toString(),
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-c:a",
      "aac",
      "-y",
      outputPath,
    ]);

    await unlink(videoPath);
    return outputPath;
  }

  // 如果只有图片，生成静态视频
  if (scene.imageUrl) {
    const imagePath = await downloadFile(
      scene.imageUrl,
      `image_${scene.order}.jpg`
    );

    await runFFmpeg([
      "-loop",
      "1",
      "-i",
      imagePath,
      "-t",
      scene.duration.toString(),
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      "-y",
      outputPath,
    ]);

    await unlink(imagePath);
    return outputPath;
  }

  // 生成黑色背景视频
  await runFFmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:d=${scene.duration}`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-y",
    outputPath,
  ]);

  return outputPath;
}

/**
 * 合成完整视频
 */
export async function synthesizeVideo(
  scenes: SceneMedia[],
  options: ExportOptions,
  onProgress?: (progress: number) => void
): Promise<Buffer> {
  const tmpDir = path.join(
    os.tmpdir(),
    "ai-comic-export",
    Date.now().toString()
  );
  await mkdir(tmpDir, { recursive: true });

  try {
    // 1. 生成每个分镜的视频片段
    const videoClips: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const clip = await sceneToVideoClip(scenes[i], tmpDir, options);
      videoClips.push(clip);
      onProgress?.(Math.round(((i + 1) / scenes.length) * 50));
    }

    // 2. 合并所有视频片段
    //
    // v2：默认走 xfade 过渡（0.3s 渐隐），消除镜头切换处的"角色跳变"硬切感。
    //     环境变量 ENABLE_VIDEO_XFADE=0 时回退到 concat -c copy 的旧行为（零重编码、速度快）。
    //     单镜头或 <2 段时自动跳过 xfade（无意义且 filter 会报错）。
    const mergedPath = path.join(tmpDir, "merged.mp4");
    const xfadeEnabled =
      process.env.ENABLE_VIDEO_XFADE !== "0" && videoClips.length >= 2;

    if (xfadeEnabled) {
      // xfade filter_complex 链：每两段之间插一段 0.3s fade
      // offset = 累计前置时长 - 0.3（让 fade 在前一段末尾开始）
      const FADE_DURATION = 0.3;
      const filterParts: string[] = [];
      let prevTag = "[0:v]";
      let cumulative = 0;
      for (let i = 1; i < videoClips.length; i += 1) {
        cumulative += Math.max(scenes[i - 1].duration, 1);
        const offset = Math.max(cumulative - FADE_DURATION, 0).toFixed(3);
        const out = i === videoClips.length - 1 ? "[outv]" : `[v${i}]`;
        filterParts.push(
          `${prevTag}[${i}:v]xfade=transition=fade:duration=${FADE_DURATION}:offset=${offset}${out}`
        );
        prevTag = out;
      }
      const filterComplex = filterParts.join(";");

      const args: string[] = [];
      for (const clip of videoClips) {
        args.push("-i", clip);
      }
      args.push(
        "-filter_complex",
        filterComplex,
        "-map",
        "[outv]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-y",
        mergedPath
      );
      await runFFmpeg(args);
    } else {
      // 旧行为：concat demuxer + -c copy
      const listPath = path.join(tmpDir, "videos.txt");
      const listContent = videoClips.map((p) => `file '${p}'`).join("\n");
      await writeFile(listPath, listContent);
      await runFFmpeg([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        "-y",
        mergedPath,
      ]);
    }

    onProgress?.(60);

    // 4. 处理音频
    const audioInputs: string[] = [];
    const audioFilters: string[] = [];
    let audioIndex = 0;

    if (options.includeAudio) {
      let currentTime = 0;
      for (const scene of scenes) {
        if (scene.audioUrl) {
          const audioPath = await downloadFile(
            scene.audioUrl,
            `audio_${scene.order}.mp3`
          );
          audioInputs.push("-i", audioPath);
          audioFilters.push(
            `[${audioIndex + 1}:a]adelay=${Math.round(currentTime * 1000)}|${Math.round(currentTime * 1000)}[a${audioIndex}]`
          );
          audioIndex++;
        }
        currentTime += scene.duration;
      }
    }

    onProgress?.(70);

    // 5. 生成字幕
    let subtitlePath: string | null = null;
    if (options.includeSubtitles) {
      subtitlePath = await generateSubtitleFile(scenes, tmpDir);
    }

    onProgress?.(80);

    // 6. 最终合成
    const quality = QUALITY_SETTINGS[options.quality];
    const outputPath = path.join(tmpDir, `output.${options.format}`);

    const ffmpegArgs = ["-i", mergedPath];

    // 添加音频输入
    ffmpegArgs.push(...audioInputs);

    // 视频滤镜
    let videoFilter = `scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2:black`;

    // 添加字幕
    if (subtitlePath) {
      videoFilter += `,subtitles='${subtitlePath.replace(/'/g, "'\\''")}'`;
    }

    ffmpegArgs.push("-vf", videoFilter);

    // 音频混合
    if (audioFilters.length > 0) {
      const mixInputs = audioFilters.map((_, i) => `[a${i}]`).join("");
      ffmpegArgs.push(
        "-filter_complex",
        `${audioFilters.join(";")}; ${mixInputs}amix=inputs=${audioFilters.length}[aout]`,
        "-map",
        "0:v",
        "-map",
        "[aout]"
      );
    }

    // 输出设置
    ffmpegArgs.push(
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-b:v",
      quality.bitrate,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      outputPath
    );

    await runFFmpeg(ffmpegArgs);

    onProgress?.(95);

    // 7. 读取输出文件
    const { readFile } = await import("fs/promises");
    const videoBuffer = await readFile(outputPath);

    onProgress?.(100);

    return videoBuffer;
  } finally {
    // 清理临时文件
    try {
      const { rm } = await import("fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 计算音画自动对齐后的时长
 * 根据配音时长自动调整视频片段长度
 */
export function calculateAlignedDuration(
  audioDuration: number | null,
  minDuration: number = 2
): number {
  if (!audioDuration) return minDuration;
  // 视频时长 = 配音时长 + 0.5s 缓冲
  return Math.max(audioDuration + 0.5, minDuration);
}

/**
 * 获取音频时长（需要 ffprobe）
 */
export async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]);

    let stdout = "";
    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        resolve(parseFloat(stdout.trim()) || 0);
      } else {
        reject(new Error("Failed to get audio duration"));
      }
    });

    ffprobe.on("error", reject);
  });
}
