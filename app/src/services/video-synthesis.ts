/**
 * 视频合成服务
 * 使用 FFmpeg 将多个分镜合成为完整视频
 */

import { spawn } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
// 字幕样式 / 水印类型统一从 types/export-style 导入（单一权威来源），
// 避免与前端、导出 API 各自重复定义导致字段漂移。
import type {
  SubtitleStyle,
  Watermark,
  Sticker,
  Transition,
  TransitionType,
  SceneEffect,
  SceneEffectId,
} from "@/types/export-style";

export type { SubtitleStyle, Watermark, Sticker, Transition, SceneEffect };

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
  /** 字幕样式，仅在 includeSubtitles=true 时生效 */
  subtitleStyle?: SubtitleStyle;
  /** 商标水印配置 */
  watermark?: Watermark;
  /** 贴图列表（按分镜叠加，导出时 overlay + enable 时间窗） */
  stickers?: Sticker[];
  /**
   * 分镜间转场配置（第 k 项 = 第 k 与 k+1 分镜之间）。
   * 缺省或某项缺失时回退默认 fade 0.3s，保持与旧行为一致。
   */
  transitions?: Transition[];
  /**
   * 分镜级画面调节（滤镜 / 变速），按 sceneId 关联。
   * 缺省时片段不加滤镜、不变速。
   */
  sceneEffects?: SceneEffect[];
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
 * 片段滤镜预设：id → FFmpeg 滤镜表达式
 * 移植自 MagicalCanvas，覆盖常用调色/做旧效果。
 */
const FX_FILTERS: Record<SceneEffectId, string> = {
  bw: "hue=s=0",
  vivid: "eq=saturation=1.45:contrast=1.08",
  sepia: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
  cold: "colorbalance=bs=.18:rs=-.05",
  warm: "colorbalance=rs=.16:bs=-.12",
  vignette: "vignette=PI/4.5",
  blur: "gblur=sigma=8",
  oldfilm:
    "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,noise=alls=10:allf=t,vignette=PI/4.5",
  sharpen: "unsharp=5:5:1.0",
  vintage: "curves=preset=vintage",
  tealorange: "colorbalance=rs=.2:bs=-.2,eq=saturation=1.25",
  dreampurple: "colorbalance=rs=.1:bs=.25",
};

/**
 * FFmpeg xfade 支持的转场类型白名单。
 * 不在白名单内（或 "none"）的一律回退 fade，避免 filter 报错。
 */
const XFADE_TYPES = new Set<TransitionType>([
  "fade",
  "fadeblack",
  "fadewhite",
  "dissolve",
  "wipeleft",
  "wiperight",
  "wipeup",
  "wipedown",
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  "circleopen",
  "circleclose",
  "radial",
  "smoothleft",
  "smoothright",
]);

/** 默认转场时长（秒），与历史行为一致 */
const DEFAULT_FADE_DURATION = 0.3;

/**
 * 把任意变速倍率拆成 FFmpeg atempo 允许的 0.5–2.0 链。
 * atempo 单次只接受 0.5–2.0，超出需级联。移植自 MagicalCanvas。
 */
function buildAtempoChain(speed: number): string[] {
  const parts: string[] = [];
  let s = speed;
  while (s > 2.0) {
    parts.push("atempo=2.0");
    s /= 2.0;
  }
  while (s < 0.5) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 0.001) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

/**
 * 解析某分镜的画面调节配置（滤镜 + 变速），带边界校验。
 */
function resolveSceneEffect(
  sceneId: string,
  effects?: SceneEffect[]
): { effect: string | null; speed: number } {
  const found = effects?.find((e) => e.sceneId === sceneId);
  const effectId = found?.effect;
  const effect = effectId && FX_FILTERS[effectId] ? FX_FILTERS[effectId] : null;
  const rawSpeed = found?.speed;
  const speed =
    rawSpeed != null && !isNaN(Number(rawSpeed))
      ? Math.min(4, Math.max(0.25, Number(rawSpeed)))
      : 1;
  return { effect, speed };
}

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
  outputPath: string,
  sceneEffects?: SceneEffect[]
): Promise<string> {
  let srtContent = "";
  let index = 1;
  let currentTime = 0;

  for (const scene of scenes) {
    // 字幕时轴用「有效时长」（变速后），与画面/配音对齐
    const { speed } = resolveSceneEffect(scene.id, sceneEffects);
    const effDuration = scene.duration / speed;
    const text = scene.dialogue || scene.narration;
    if (text) {
      const startTime = formatSrtTime(currentTime);
      const endTime = formatSrtTime(currentTime + effDuration);

      srtContent += `${index}\n`;
      srtContent += `${startTime} --> ${endTime}\n`;
      srtContent += `${text}\n\n`;
      index++;
    }
    currentTime += effDuration;
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
 * 将 #RRGGBB 转换为 ASS 颜色格式 &H00BBGGRR
 * ASS 颜色顺序是 BGR（与 HTML 相反），alpha 通道 00 = 不透明
 */
function hexToAssColor(hex: string): string {
  // 去掉 # 号，提取 RGB 分量
  const cleaned = hex.replace(/^#/, "");
  const r = cleaned.substring(0, 2);
  const g = cleaned.substring(2, 4);
  const b = cleaned.substring(4, 6);
  // ASS 格式：&H{alpha:2}{B:2}{G:2}{R:2}，alpha 00 = 完全不透明
  return `&H00${b}${g}${r}`.toUpperCase();
}

/**
 * 将 position 转换为 ASS Alignment 数值
 * ASS Alignment：numpad 布局，8=上 5=中 2=下
 */
function positionToAssAlignment(position: SubtitleStyle["position"]): number {
  const map: Record<SubtitleStyle["position"], number> = {
    top: 8,
    middle: 5,
    bottom: 2,
  };
  return map[position];
}

/**
 * 构建字幕 force_style 参数字符串
 * 将 SubtitleStyle 转换为 FFmpeg subtitles filter 的 force_style 格式
 */
function buildSubtitleForceStyle(style: SubtitleStyle): string {
  const alignment = positionToAssAlignment(style.position);
  // BorderStyle: 4=底框(OpaqueBox) 1=描边(Outline)
  const borderStyle = style.backgroundBox ? 4 : 1;
  const bold = style.bold ? 1 : 0;
  const primaryColour = hexToAssColor(style.fontColor);
  const outlineColour = hexToAssColor(style.outlineColor);

  return [
    `FontSize=${style.fontSize}`,
    `PrimaryColour=${primaryColour}`,
    `OutlineColour=${outlineColour}`,
    `Outline=${style.outlineWidth}`,
    `Alignment=${alignment}`,
    `Bold=${bold}`,
    `BorderStyle=${borderStyle}`,
  ].join(",");
}

/**
 * 构建字幕 filter 片段
 * 仅在 includeSubtitles && subtitlePath 不为 null 时调用
 */
function buildSubtitleFilter(
  subtitlePath: string,
  subtitleStyle?: SubtitleStyle
): string {
  // 转义路径中的单引号（FFmpeg filter 语法要求）
  const escapedPath = subtitlePath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");

  if (subtitleStyle) {
    const forceStyle = buildSubtitleForceStyle(subtitleStyle);
    return `subtitles='${escapedPath}':force_style='${forceStyle}'`;
  }
  // 无自定义样式时使用默认渲染
  return `subtitles='${escapedPath}'`;
}

/**
 * 获取水印位置的 FFmpeg overlay 坐标表达式（边距 20px）
 */
function getWatermarkOverlayExpr(position: Watermark["position"]): string {
  const map: Record<Watermark["position"], string> = {
    tl: "20:20",
    tr: "W-w-20:20",
    bl: "20:H-h-20",
    br: "W-w-20:H-h-20",
    center: "(W-w)/2:(H-h)/2",
  };
  return map[position];
}

/** 解析后的贴图：已下载本地路径 + 时间窗 + 位置缩放 */
interface PreparedSticker {
  localPath: string;
  /** 出现起始秒（全片时间轴） */
  start: number;
  /** 结束秒（全片时间轴） */
  end: number;
  /** 相对画面 0-1 位置 */
  x: number;
  y: number;
  /** 相对画面宽缩放 0-1 */
  scale: number;
}

/**
 * 下载并准备贴图：按分镜计算时间窗（全片累计起始 + 分镜内偏移/时长）。
 * 下载失败的贴图静默跳过。
 */
async function prepareStickers(
  stickers: Sticker[],
  scenes: SceneMedia[],
  _tmpDir: string,
  sceneEffects?: SceneEffect[]
): Promise<PreparedSticker[]> {
  // 计算每个分镜的全片起始时间与有效时长（随变速对齐）
  const sceneStart: Record<string, number> = {};
  const sceneEffDur: Record<string, number> = {};
  let cursor = 0;
  for (const sc of scenes) {
    const { speed } = resolveSceneEffect(sc.id, sceneEffects);
    const effDuration = sc.duration / speed;
    sceneStart[sc.id] = cursor;
    sceneEffDur[sc.id] = effDuration;
    cursor += effDuration;
  }

  const prepared: PreparedSticker[] = [];
  let idx = 0;
  for (const st of stickers) {
    if (!st.imageUrl || sceneStart[st.sceneId] === undefined) continue;
    const scene = scenes.find((s) => s.id === st.sceneId);
    if (!scene) continue;
    const base = sceneStart[st.sceneId];
    const sceneEnd = base + sceneEffDur[st.sceneId];
    const offset = st.startOffset ?? 0;
    const start = base + offset;
    const end =
      st.duration !== undefined
        ? Math.min(start + st.duration, sceneEnd)
        : sceneEnd;
    try {
      const localPath = await downloadFile(st.imageUrl, `sticker_${idx}.png`);
      prepared.push({
        localPath,
        start,
        end,
        x: st.x,
        y: st.y,
        scale: st.scale,
      });
      idx += 1;
    } catch {
      // 单个贴图下载失败不阻塞导出
    }
  }
  return prepared;
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

/** 单分镜片段产物：本地路径 + 变速后的有效时长（供 xfade/音频累计对齐） */
interface SceneClip {
  path: string;
  /** 片段在成片时间轴上的有效时长（秒）= scene.duration / speed */
  effectiveDuration: number;
}

/**
 * 构建片段视频滤镜链：scale+pad（统一画幅）→ 可选 FX 滤镜 → 可选变速。
 * 变速用 setpts=PTS/speed 改变视频流时长。
 */
function buildClipVideoFilter(
  width: number,
  height: number,
  effect: string | null,
  speed: number
): string {
  const parts = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
  ];
  if (effect) parts.push(effect);
  if (speed !== 1) parts.push(`setpts=PTS/${speed.toFixed(4)}`);
  return parts.join(",");
}

/**
 * 将单个分镜转换为视频片段。
 * 支持滤镜（FX）与变速（speed）：变速同时作用于画面（setpts）与音轨（atempo），
 * 并返回变速后的有效时长，供后续 xfade offset 与音频 adelay 累计对齐。
 */
async function sceneToVideoClip(
  scene: SceneMedia,
  outputDir: string,
  options: ExportOptions
): Promise<SceneClip> {
  const { width, height } = ASPECT_RATIOS[options.aspectRatio];
  const outputPath = path.join(outputDir, `scene_${scene.order}.mp4`);

  const { effect, speed } = resolveSceneEffect(scene.id, options.sceneEffects);
  // 截断时长用原始 duration（截在变速前的源时间轴上）；
  // 有效时长 = 原始时长 / 倍速（成片时间轴上的占位）。
  const effectiveDuration = scene.duration / speed;
  const vf = buildClipVideoFilter(width, height, effect, speed);

  // 如果有视频，直接使用
  if (scene.videoUrl) {
    const videoPath = await downloadFile(
      scene.videoUrl,
      `video_${scene.order}.mp4`
    );

    // 视频带音轨：用 filter_complex 同时处理画面与音频变速
    const filterComplex =
      speed !== 1
        ? `[0:v]${vf}[v];[0:a]${buildAtempoChain(speed).join(",")}[a]`
        : `[0:v]${vf}[v]`;
    const args = [
      "-i",
      videoPath,
      "-t",
      scene.duration.toString(),
      "-filter_complex",
      filterComplex,
      "-map",
      "[v]",
      ...(speed !== 1 ? ["-map", "[a]"] : ["-map", "0:a?"]),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-c:a",
      "aac",
      "-y",
      outputPath,
    ];
    await runFFmpeg(args);

    await unlink(videoPath);
    return { path: outputPath, effectiveDuration };
  }

  // 如果只有图片，生成静态视频（图片无音轨，变速仅影响时长 → 直接用有效时长生成）
  if (scene.imageUrl) {
    const imagePath = await downloadFile(
      scene.imageUrl,
      `image_${scene.order}.jpg`
    );

    // 图片场景：滤镜照常应用，但变速对静态图无意义（画面不动），
    // 用有效时长直接 -t 即可（无需 setpts）。
    const imgVf = buildClipVideoFilter(width, height, effect, 1);
    await runFFmpeg([
      "-loop",
      "1",
      "-i",
      imagePath,
      "-t",
      effectiveDuration.toString(),
      "-vf",
      imgVf,
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
    return { path: outputPath, effectiveDuration };
  }

  // 生成黑色背景视频
  await runFFmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:d=${effectiveDuration}`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-y",
    outputPath,
  ]);

  return { path: outputPath, effectiveDuration };
}

/**
 * 合成完整视频
 *
 * filter_complex 架构说明（有水印时）：
 *   [0:v] scale+pad+subtitles [base];
 *   [logoIdx:v] scale,format=rgba,colorchannelmixer=aa=<opacity> [wm];
 *   [base][wm] overlay=<expr> [outv];
 *   （音频链独立用 ; 分隔）
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
    // 1. 生成每个分镜的视频片段（含滤镜/变速；返回变速后的有效时长）
    const clips: SceneClip[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const clip = await sceneToVideoClip(scenes[i], tmpDir, options);
      clips.push(clip);
      onProgress?.(Math.round(((i + 1) / scenes.length) * 50));
    }
    const videoClips = clips.map((c) => c.path);
    // 成片时间轴上各片段的有效时长（变速后），用于 xfade offset 与音频累计对齐
    const effDurations = clips.map((c) => c.effectiveDuration);

    // 解析每个衔接处（k = 第 k 与 k+1 分镜之间）的转场类型与时长。
    // 转场时长上限不超过相邻两段有效时长的一半，避免 offset 越界导致 xfade 报错。
    const resolveTransition = (
      k: number
    ): { type: TransitionType; duration: number } => {
      const t = options.transitions?.[k];
      const rawType = t?.type;
      const type: TransitionType =
        rawType && XFADE_TYPES.has(rawType) ? rawType : "fade";
      // "none"（硬切）用极短淡化≈0.04s 近似，统一走 xfade 管线
      const isNone = rawType === "none";
      const rawDur = isNone ? 0.04 : (t?.duration ?? DEFAULT_FADE_DURATION);
      const maxDur = Math.max(
        0.1,
        Math.min(effDurations[k], effDurations[k + 1]) / 2
      );
      const duration = Math.min(Math.max(rawDur, 0.04), maxDur);
      return { type: isNone ? "fade" : type, duration };
    };

    // 2. 合并所有视频片段
    //
    // v3：默认走 xfade 过渡，消除镜头切换处的"角色跳变"硬切感。
    //     - 转场类型/时长可由 options.transitions 配置（缺省 fade 0.3s）。
    //     - 每段进 xfade 前用 tpad 克隆末帧补垫，修复转场窗口落在视频流末尾后的"黑闪"
    //       （部分视频容器声明时长 > 视频流实际时长）。
    //     环境变量 ENABLE_VIDEO_XFADE=0 时回退 concat -c copy 旧行为（零重编码、速度快）。
    //     单镜头或 <2 段时自动跳过 xfade。
    const mergedPath = path.join(tmpDir, "merged.mp4");
    const xfadeEnabled =
      process.env.ENABLE_VIDEO_XFADE !== "0" && videoClips.length >= 2;

    if (xfadeEnabled) {
      const filterParts: string[] = [];

      // ── 2a. 每段先 tpad 补垫（补「该段右侧转场时长 + 0.2s 余量」）──
      // 末段无右侧转场，不补垫。
      for (let i = 0; i < videoClips.length; i += 1) {
        const padOut =
          i < videoClips.length - 1 ? resolveTransition(i).duration + 0.2 : 0;
        if (padOut > 0) {
          filterParts.push(
            `[${i}:v]tpad=stop_mode=clone:stop_duration=${padOut.toFixed(3)}[vp${i}]`
          );
        } else {
          // 末段直接透传（保持标签统一为 vp{i}）
          filterParts.push(`[${i}:v]null[vp${i}]`);
        }
      }

      // ── 2b. xfade 链：offset = 累计有效时长 - 当前转场时长 ──
      let prevTag = "[vp0]";
      let cumulative = effDurations[0];
      for (let i = 1; i < videoClips.length; i += 1) {
        const { type, duration } = resolveTransition(i - 1);
        const offset = Math.max(cumulative - duration, 0).toFixed(3);
        const out = i === videoClips.length - 1 ? "[outv]" : `[vx${i}]`;
        filterParts.push(
          `${prevTag}[vp${i}]xfade=transition=${type}:duration=${duration.toFixed(3)}:offset=${offset}${out}`
        );
        prevTag = out;
        cumulative += effDurations[i] - duration;
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
      // 累计用「有效时长」（变速后），与视频片段在成片时间轴上对齐，
      // 避免分镜变速后配音延迟错位。
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
        const { speed } = resolveSceneEffect(scene.id, options.sceneEffects);
        currentTime += scene.duration / speed;
      }
    }

    onProgress?.(70);

    // 5. 生成字幕（时轴随变速对齐）
    let subtitlePath: string | null = null;
    if (options.includeSubtitles) {
      subtitlePath = await generateSubtitleFile(
        scenes,
        tmpDir,
        options.sceneEffects
      );
    }

    onProgress?.(80);

    // 6. 下载水印 logo（如果启用）
    let logoPath: string | null = null;
    if (options.watermark?.enabled && options.watermark.imageUrl) {
      try {
        logoPath = await downloadFile(
          options.watermark.imageUrl,
          `watermark_logo.png`
        );
      } catch (err) {
        // 水印下载失败不阻塞主流程，记录警告后继续
        console.warn("[video-synthesis] 水印 logo 下载失败，跳过水印:", err);
        logoPath = null;
      }
    }

    // 6.5 准备贴图（按分镜时间窗 overlay，时间窗随变速对齐）
    const preparedStickers =
      options.stickers && options.stickers.length > 0
        ? await prepareStickers(
            options.stickers,
            scenes,
            tmpDir,
            options.sceneEffects
          )
        : [];

    // 7. 最终合成
    const quality = QUALITY_SETTINGS[options.quality];
    const outputPath = path.join(tmpDir, `output.${options.format}`);

    // 判断是否需要 overlay 链（水印或贴图任一启用都走 filter_complex）
    const hasWatermark = logoPath !== null && options.watermark?.enabled;
    const hasStickers = preparedStickers.length > 0;

    if (hasWatermark || hasStickers) {
      // ─────────────────────────────────────────────────────────────────
      // 有水印：必须使用 filter_complex（多输入 overlay 不能用 -vf）
      // 输入顺序：[0]=merged视频  [1..N]=音频轨  [N+1]=logo
      // ─────────────────────────────────────────────────────────────────
      const ffmpegArgs: string[] = ["-i", mergedPath];

      // 先添加音频输入；overlay 图片输入排在音频之后
      ffmpegArgs.push(...audioInputs);
      // audioInputs 每条音轨用 2 个元素("-i", path)；overlay 输入索引从此处开始
      let nextInputIndex = 1 + audioInputs.length / 2;

      // ── 视频基链 ────────────────────────────────────────────────────
      // [0:v] → scale+pad → 可选字幕 → [base]
      let videoChain = `[0:v]scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2:black`;
      if (subtitlePath) {
        videoChain += `,${buildSubtitleFilter(subtitlePath, options.subtitleStyle)}`;
      }
      videoChain += "[base]";

      const filterParts: string[] = [videoChain];
      // 当前 overlay 链的输入标签（从 base 开始，逐层叠加）
      let currentLabel = "[base]";
      let overlayCounter = 0;

      // ── 水印 logo 链（如有）─────────────────────────────────────────
      if (hasWatermark && options.watermark && logoPath) {
        const wm = options.watermark;
        const logoIdx = nextInputIndex;
        ffmpegArgs.push("-i", logoPath);
        nextInputIndex += 1;
        const overlayExpr = getWatermarkOverlayExpr(wm.position);
        const logoScale = `${quality.width}*${wm.scale}`;
        filterParts.push(
          `[${logoIdx}:v]scale=${logoScale}:-1,format=rgba,colorchannelmixer=aa=${wm.opacity}[wm]`
        );
        const outLabel = "[ov0]";
        filterParts.push(
          `${currentLabel}[wm]overlay=${overlayExpr}${outLabel}`
        );
        currentLabel = outLabel;
        overlayCounter += 1;
      }

      // ── 贴图链（每个带时间窗 enable）─────────────────────────────────
      for (const st of preparedStickers) {
        const stIdx = nextInputIndex;
        ffmpegArgs.push("-i", st.localPath);
        nextInputIndex += 1;
        const stScale = `${quality.width}*${st.scale}`;
        const sLabel = `[s${overlayCounter}]`;
        filterParts.push(
          `[${stIdx}:v]scale=${stScale}:-1,format=rgba${sLabel}`
        );
        // 位置：x*(W) 偏移；用 main_w/main_h 算绝对像素
        const posX = `(W-w)*${st.x}`;
        const posY = `(H-h)*${st.y}`;
        const outLabel = `[ov${overlayCounter + 1}]`;
        filterParts.push(
          `${currentLabel}${sLabel}overlay=${posX}:${posY}:enable='between(t,${st.start.toFixed(2)},${st.end.toFixed(2)})'${outLabel}`
        );
        currentLabel = outLabel;
        overlayCounter += 1;
      }

      // 最终视频输出标签统一为 [outv]：把最后一条 overlay 的尾部输出标签替换
      if (currentLabel !== "[base]") {
        const lastIdx = filterParts.length - 1;
        // 仅替换结尾处的输出标签（currentLabel 必定出现在该条末尾）
        filterParts[lastIdx] = filterParts[lastIdx].replace(
          new RegExp(`${currentLabel.replace(/[[\]]/g, "\\$&")}$`),
          "[outv]"
        );
      }

      // ── 音频链（与视频链用 ; 分隔，共同放入同一 filter_complex）──────
      if (audioFilters.length > 0) {
        // 音频 adelay 的索引需要从 1 开始（音频输入在 merged 之后），不受 logo 影响
        filterParts.push(...audioFilters);
        const mixInputs = audioFilters.map((_, i) => `[a${i}]`).join("");
        filterParts.push(
          `${mixInputs}amix=inputs=${audioFilters.length}[aout]`
        );
      }

      ffmpegArgs.push("-filter_complex", filterParts.join(";"));

      // ── map 输出流 ──────────────────────────────────────────────────
      ffmpegArgs.push("-map", "[outv]");
      if (audioFilters.length > 0) {
        ffmpegArgs.push("-map", "[aout]");
      }

      // ── 编码参数 ────────────────────────────────────────────────────
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
    } else {
      // ─────────────────────────────────────────────────────────────────
      // 无水印：保持原有路径（-vf 处理视频，-filter_complex 处理音频混合）
      // 最小改动，不破坏现有音频/字幕行为
      // ─────────────────────────────────────────────────────────────────
      const ffmpegArgs: string[] = ["-i", mergedPath];

      // 添加音频输入
      ffmpegArgs.push(...audioInputs);

      // 构建视频滤镜（-vf 路径）
      let videoFilter = `scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2:black`;

      // 添加字幕（带可选样式）
      if (subtitlePath) {
        videoFilter += `,${buildSubtitleFilter(subtitlePath, options.subtitleStyle)}`;
      }

      ffmpegArgs.push("-vf", videoFilter);

      // 音频混合（单独的 filter_complex，与 -vf 共存）
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
    }

    onProgress?.(95);

    // 8. 读取输出文件
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
