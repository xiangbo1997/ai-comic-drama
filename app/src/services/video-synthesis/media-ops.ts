/**
 * 视频合成 —— 独立媒体操作（探测 / 裁剪 / 抽帧 / 拼接）
 *
 * 从 services/video-synthesis.ts 原样提取（零行为变更）。这组函数与导出主管线
 * 无耦合：各自建独占临时目录、finally 清理，供分段视频生成、剪映草稿、视频/音频
 * 落库回写等多处调用。
 */

import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import { safeDownload } from "@/lib/url-guard";
import {
  absolutizeUrl,
  runFFmpeg,
} from "@/services/video-synthesis/ffmpeg-run";

/**
 * 获取媒体（音频/视频）时长（需要 ffprobe）。
 * ffprobe 的 format=duration 对任意媒体容器通用，故命名为 getMediaDuration。
 */
export async function getMediaDuration(mediaPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      mediaPath,
    ]);

    let stdout = "";
    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        resolve(parseFloat(stdout.trim()) || 0);
      } else {
        reject(new Error("Failed to get media duration"));
      }
    });

    ffprobe.on("error", reject);
  });
}

/**
 * 把视频 Buffer 从开头裁到目标时长（秒），返回裁剪后的 MP4 Buffer。
 *
 * 剪辑节奏回归（批2）：provider 常返回 5–8s 片段，而漫剧专业节奏要求单镜 1–4s
 * 快切。这里保留开头、只砍尾部，把片段裁到 shot-timing 算出的叙事目标时长，
 * 让「视频真实长度 = 分镜叙事时长」，恢复快节奏。
 *
 * 实现细节：`-ss 0 -t {target}` 从头截取；`-c copy` 无损快裁（关键帧对齐可能
 * 有 ±1 帧误差，对节奏无感），失败或产物为空时由调用方降级沿用原片段。
 * 若源片段本就 ≤ 目标时长（罕见：provider 返回比目标短），ffmpeg 自然只输出
 * 实际长度，不会补长——调用方据此不会误判。
 *
 * @param videoBuffer 源视频字节
 * @param targetSeconds 目标时长（秒，>0）
 * @returns 裁剪后的 MP4 字节
 * @throws ffmpeg 失败或产物为空时抛错（调用方决定是否降级沿用原片段）
 */
export async function trimVideoToDuration(
  videoBuffer: Buffer,
  targetSeconds: number
): Promise<Buffer> {
  const tmpDir = path.join(
    os.tmpdir(),
    "ai-comic-trim",
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  await mkdir(tmpDir, { recursive: true });
  const inputPath = path.join(tmpDir, "seg.mp4");
  const outputPath = path.join(tmpDir, "trimmed.mp4");
  try {
    await writeFile(inputPath, videoBuffer);
    // -ss 0 -t {target}：从头保留到目标时长；-c copy 无损快裁 + faststart 便于播放
    await runFFmpeg([
      "-ss",
      "0",
      "-i",
      inputPath,
      "-t",
      targetSeconds.toFixed(3),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ]);
    const { readFile } = await import("fs/promises");
    const trimmed = await readFile(outputPath);
    if (trimmed.length === 0) {
      throw new Error("裁剪产物为空");
    }
    return trimmed;
  } finally {
    try {
      const { rm } = await import("fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 从视频 Buffer 提取「最后一帧」为 JPEG Buffer。
 *
 * 分段生成链式衔接的核心：第 k 段的末帧作为第 k+1 段的首帧图，让相邻段无缝续接。
 * 用 `-sseof -0.5` 定位到结尾前 0.5s，`-update 1 -frames:v 1` 只出 1 帧，
 * `-q:v 2` 高质量 JPEG。全程本地临时文件，finally 清理。
 *
 * @param videoBuffer 源视频字节
 * @returns 末帧 JPEG 字节
 * @throws ffmpeg 失败或产物为空时抛错（调用方决定是否降级）
 */
export async function extractLastFrame(videoBuffer: Buffer): Promise<Buffer> {
  const tmpDir = path.join(
    os.tmpdir(),
    "ai-comic-lastframe",
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  await mkdir(tmpDir, { recursive: true });
  const inputPath = path.join(tmpDir, "seg.mp4");
  const framePath = path.join(tmpDir, "frame.jpg");
  try {
    await writeFile(inputPath, videoBuffer);
    // -sseof 放在 -i 前作为输入定位（结尾前 0.5s 起）；-update 1 覆盖式写单帧
    await runFFmpeg([
      "-sseof",
      "-0.5",
      "-i",
      inputPath,
      "-update",
      "1",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-y",
      framePath,
    ]);
    const { readFile } = await import("fs/promises");
    const frame = await readFile(framePath);
    if (frame.length === 0) {
      throw new Error("提取末帧为空");
    }
    return frame;
  } finally {
    try {
      const { rm } = await import("fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 把多段视频 Buffer 按序拼接为单条 MP4 Buffer。
 *
 * 分段生成的收尾：各段独立生成后拼成一条落库为单 scene.videoUrl。用 concat
 * demuxer 列表 + 统一「重编码 h264/aac」规范化——各段可能来自同一模型但分辨率/
 * 帧率/时基不完全一致，`-c copy` 会拼接报错或花屏，故重编码兜底一致性。
 *
 * @param segments 已按顺序排列的各段视频字节（至少 2 段才有意义；1 段应由调用方直接返回）
 * @returns 拼接后的 MP4 字节
 * @throws 段数 <1 或 ffmpeg 失败时抛错
 */
export async function concatVideos(segments: Buffer[]): Promise<Buffer> {
  if (segments.length === 0) {
    throw new Error("concatVideos: 无可拼接的视频段");
  }
  const tmpDir = path.join(
    os.tmpdir(),
    "ai-comic-concat",
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  await mkdir(tmpDir, { recursive: true });
  try {
    const segPaths: string[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      const p = path.join(tmpDir, `seg_${i}.mp4`);
      await writeFile(p, segments[i]);
      segPaths.push(p);
    }
    const listPath = path.join(tmpDir, "segments.txt");
    // concat demuxer 列表：路径需转义单引号（ffmpeg 语法）
    const listContent = segPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await writeFile(listPath, listContent);

    const outputPath = path.join(tmpDir, "concat.mp4");
    // 重编码规范化：统一 h264/aac + faststart（网页边下边播）；音轨可缺（0:a?）
    await runFFmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ]);

    const { readFile } = await import("fs/promises");
    return await readFile(outputPath);
  } finally {
    try {
      const { rm } = await import("fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 把多段音频 Buffer 按序拼接为单条 MP3 Buffer。
 *
 * 用途：一键 workflow 里同一分镜既有旁白又有对白时，旁白（说书人声线）作场景铺垫
 * 在前、对白（角色声线）在后，两段独立合成后用此函数拼成单条音轨落库。用 concat
 * demuxer + 统一重编码 mp3——两段可能来自不同 provider / 采样率，`-c copy` 会拼接
 * 报错或时基错乱，重编码兜底一致性。
 *
 * @param segments 已按顺序排列的各段音频字节（1 段应由调用方直接返回，无需拼接）
 * @returns 拼接后的 MP3 字节
 * @throws 段数 <1 或 ffmpeg 失败时抛错
 */
export async function concatAudioBuffers(segments: Buffer[]): Promise<Buffer> {
  if (segments.length === 0) {
    throw new Error("concatAudioBuffers: 无可拼接的音频段");
  }
  const tmpDir = path.join(
    os.tmpdir(),
    "ai-comic-audio-concat",
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  await mkdir(tmpDir, { recursive: true });
  try {
    const segPaths: string[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      const p = path.join(tmpDir, `seg_${i}.mp3`);
      await writeFile(p, segments[i]);
      segPaths.push(p);
    }
    const listPath = path.join(tmpDir, "segments.txt");
    // concat demuxer 列表：路径需转义单引号（ffmpeg 语法）
    const listContent = segPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await writeFile(listPath, listContent);

    const outputPath = path.join(tmpDir, "concat.mp3");
    // 重编码规范化：统一 mp3（libmp3lame），消除跨 provider 采样率/时基差异
    await runFFmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      "-y",
      outputPath,
    ]);

    const { readFile } = await import("fs/promises");
    return await readFile(outputPath);
  } finally {
    try {
      const { rm } = await import("fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 探测「一个 URL 指向的媒体」的真实时长（秒），供视频生成成功后回写 Scene.duration。
 *
 * 语义：一旦分镜有了视频，视频的真实长度就是分镜时长（provider 常忽略请求时长，
 * 返回 ~8s 片段与 DB 声明的 scene.duration 不符）。
 *
 * 取值策略：
 *   - 本地盘路径（以 / 开头，如 /uploads/...）：项目未配 R2 时文件落 public/ 磁盘，
 *     直接 ffprobe public 下的文件（存在即用），零下载。
 *   - 远程 URL：absolutize 后走 safeDownload（钉 IP 防 SSRF/TOCTOU）落临时文件，
 *     ffprobe 后清理。
 *
 * 探测失败一律抛错，由调用方决定兜底（如回退请求时长）。
 */
export async function probeMediaDurationFromUrl(url: string): Promise<number> {
  // 本地盘路径：直接 ffprobe public 下的实体文件，避免自下载自己
  if (url.startsWith("/")) {
    const localPath = path.join(process.cwd(), "public", url);
    if (existsSync(localPath)) {
      return getMediaDuration(localPath);
    }
    // 声明是本地路径但文件不存在（可能已迁 R2 或路径异常）→ 走远程分支兜底
  }

  const absoluteUrl = absolutizeUrl(url);
  const tmpDir = path.join(os.tmpdir(), "ai-comic-probe");
  if (!existsSync(tmpDir)) {
    await mkdir(tmpDir, { recursive: true });
  }
  const tmpFile = path.join(
    tmpDir,
    `probe_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`
  );
  // SSRF 防护：钉 IP 下载（校验与连接同一地址）
  const { buffer } = await safeDownload(absoluteUrl);
  await writeFile(tmpFile, buffer);
  try {
    return await getMediaDuration(tmpFile);
  } finally {
    try {
      await unlink(tmpFile);
    } catch {
      // 忽略清理错误
    }
  }
}
