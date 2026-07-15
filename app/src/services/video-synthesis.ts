/**
 * 视频合成服务
 * 使用 FFmpeg 将多个分镜合成为完整视频
 */

import { spawn } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { safeDownload } from "@/lib/url-guard";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:video-synthesis");
// 字幕样式 / 水印类型统一从 types/export-style 导入（单一权威来源），
// 避免与前端、导出 API 各自重复定义导致字段漂移。
import type {
  SubtitleStyle,
  SubtitlePosition,
  Watermark,
  Sticker,
  Transition,
  TransitionType,
  SceneEffect,
  SceneEffectId,
  BackgroundMusic,
} from "@/types/export-style";
import { resolveSubtitleXY, resolveSubtitleFontPx } from "@/types/export-style";
// 逐句字幕切分 + 时间窗分配（与预览端 preview-player 共用同一权威实现，
// 保证「逐句显示 + 淡入淡出」在预览与成片两端时轴一致）。
import {
  splitSubtitleSegments,
  allocateSubtitleWindows,
  charWidth,
  typewriterDelays,
  SUBTITLE_ANIM,
} from "@/lib/subtitle-segments";
import type { SubtitleAnimation } from "@/types/export-style";

export type {
  SubtitleStyle,
  SubtitlePosition,
  Watermark,
  Sticker,
  Transition,
  SceneEffect,
  BackgroundMusic,
};

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
  /**
   * 各分镜字幕位置覆盖（按 sceneId，归一化坐标 0-1）。
   * 缺省或某分镜不在数组中时，回退 subtitleStyle.position 的全局默认位置。
   * 与预览端用同一坐标系（resolveSubtitleXY），保证导出=预览。
   */
  subtitlePositions?: SubtitlePosition[];
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
  /** 背景音乐（BGM）配置；缺省或 enabled=false 时不混入。 */
  backgroundMusic?: BackgroundMusic;
}

/**
 * 质量档位：以竖屏（9:16）为基准的短边尺寸 + 码率。
 * 最终画幅由 resolveOutputDimensions 结合项目 aspectRatio 派生，
 * 不再写死竖屏（此前 16:9/1:1 项目被强塞进竖屏画布）。
 */
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

/** 派生后的最终输出尺寸（含码率） */
export interface OutputDimensions {
  width: number;
  height: number;
  bitrate: string;
}

/** 转为不小于 2 的偶数（libx264 要求宽高均为偶数） */
function toEvenDimension(value: number): number {
  const rounded = Math.round(value);
  const even = rounded % 2 === 0 ? rounded : rounded + 1;
  return Math.max(2, even);
}

/**
 * 由「质量档位 + 项目画幅」派生最终输出尺寸（纯函数）。
 *
 * 质量档位给出竖屏基准的短边（480/720/1080）与码率；画幅决定长短边如何摆放：
 *   - 9:16（竖）：短边×长边 = base.width × base.height（保持现状）
 *   - 16:9（横）：转置为 base.height × base.width
 *   - 1:1（方）：边长取短边（base.width，即 480/720/1080）
 * 所有尺寸收敛为偶数以满足编码器约束。
 */
export function resolveOutputDimensions(
  quality: keyof typeof QUALITY_SETTINGS,
  aspectRatio: ExportOptions["aspectRatio"]
): OutputDimensions {
  const base = QUALITY_SETTINGS[quality];
  const short = Math.min(base.width, base.height); // 短边基准（480/720/1080）
  const long = Math.max(base.width, base.height); // 长边基准（854/1280/1920）

  let width: number;
  let height: number;
  switch (aspectRatio) {
    case "16:9":
      width = long;
      height = short;
      break;
    case "1:1":
      width = short;
      height = short;
      break;
    case "9:16":
    default:
      width = short;
      height = long;
      break;
  }

  return {
    width: toEvenDimension(width),
    height: toEvenDimension(height),
    bitrate: base.bitrate,
  };
}

/**
 * 按输出容器格式返回正确的编解码器参数。
 *
 * 此前最终输出硬编码 libx264 + aac + -movflags +faststart，只适配 mp4。
 * webm 容器只接受 VP8/VP9/AV1 视频 + Vorbis/Opus 音频，用 h264/aac 会被
 * FFmpeg 拒绝（"Only VP8 or VP9 or AV1 video and Vorbis or Opus audio ...
 * are supported for WebM"），导出直接失败——webm 格式从未跑通。
 * 这里按 format 切换编码器，faststart 也仅对 mp4 追加。
 */
function buildOutputEncodingArgs(
  format: "mp4" | "webm",
  bitrate: string,
  outputPath: string
): string[] {
  if (format === "webm") {
    return [
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      bitrate,
      // VP9 需要 row-mt 提速；deadline good 平衡质量/速度
      "-row-mt",
      "1",
      "-deadline",
      "good",
      "-cpu-used",
      "2",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-y",
      outputPath,
    ];
  }
  // mp4：H.264 + AAC + faststart（网页边下边播）
  return [
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-b:v",
    bitrate,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];
}

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
 * 构建 BGM（背景音乐）混音滤镜片段。
 *
 * 两个合成分支（有水印 / 无水印）共用，避免重复。处理链：
 *   [bgm]volume → (loop ? aloop+atrim) → afade in → afade out → [bgmout]
 * 然后与对白配音轨混合：
 *   - 有配音：所有 [aK] 与 [bgmout] 一起 amix（normalize=0 防对白变小声，
 *     BGM 给低权重让对白突出）；ducking=true 时改走 sidechaincompress 闪避。
 *   - 无配音：[bgmout] 直接作为唯一音轨输出。
 *
 * @param bgm BGM 配置（已确保 enabled && url）
 * @param bgmInputIndex BGM 在 ffmpeg -i 列表中的输入索引
 * @param totalDuration 成片总时长（秒），用于 atrim 截断和 afade out 起点
 * @param voiceLabels 对白配音轨标签数组（如 ["[a0]","[a1]"]），可空
 * @returns { filters: 滤镜片段[], outLabel: 最终音频输出标签 }
 */
function buildBgmFilter(
  bgm: BackgroundMusic,
  bgmInputIndex: number,
  totalDuration: number,
  voiceLabels: string[]
): { filters: string[]; outLabel: string } {
  const filters: string[] = [];
  const vol = Math.min(1, Math.max(0, bgm.volume ?? 0.25));
  const fadeOutStart = Math.max(0, totalDuration - (bgm.fadeOut ?? 2));

  // ── BGM 处理链：volume → (aloop) → atrim → afade ──
  const chain: string[] = [`volume=${vol.toFixed(3)}`];
  if (bgm.loop !== false) {
    // 无限循环；size 给足采样数上限（约 12h@44.1k），随后必须 atrim 截断
    chain.push(`aloop=loop=-1:size=2000000000`);
  }
  // 截到成片时长并重置时间戳（loop 后必须；非 loop 时 BGM 超长也截断）
  chain.push(`atrim=0:${totalDuration.toFixed(3)}`, `asetpts=N/SR/TB`);
  if ((bgm.fadeIn ?? 0) > 0) {
    chain.push(`afade=t=in:st=0:d=${(bgm.fadeIn ?? 1.5).toFixed(3)}`);
  }
  if ((bgm.fadeOut ?? 0) > 0) {
    // afade 的 st 不支持表达式，必须是常量秒数（已在 TS 算好）
    chain.push(
      `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${(bgm.fadeOut ?? 2).toFixed(3)}`
    );
  }
  filters.push(`[${bgmInputIndex}:a]${chain.join(",")}[bgmout]`);

  // ── 无对白配音：BGM 即唯一音轨 ──
  if (voiceLabels.length === 0) {
    return { filters, outLabel: "[bgmout]" };
  }

  // ── 有对白配音 ──
  if (bgm.ducking) {
    // ducking：对白响时自动压低 BGM（剪映"语音增强"同款 sidechaincompress）
    // 1) 对白先 amix 成一条 sidechain key [voice]
    filters.push(
      `${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0[voice]`
    );
    // 2) 用 [voice] 侧链压 [bgmout]
    filters.push(
      `[bgmout][voice]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[bgmducked]`
    );
    // 3) 压好的 BGM 与对白再混合
    filters.push(`[voice][bgmducked]amix=inputs=2:normalize=0[aout]`);
    return { filters, outLabel: "[aout]" };
  }

  // 默认路线：weights 让对白突出 + normalize=0 防整体变小声
  const allInputs = [...voiceLabels, "[bgmout]"];
  const weights = [...voiceLabels.map(() => "1"), "0.6"].join(" ");
  filters.push(
    `${allInputs.join("")}amix=inputs=${allInputs.length}:normalize=0:weights='${weights}'[aout]`
  );
  return { filters, outLabel: "[aout]" };
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

// SSRF 防护（assertSafeUrl / isPrivateOrReservedIp）已提取到 @/lib/url-guard，
// 供 video-synthesis / storage / ai 测试端点等所有出站 fetch 复用。

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
  // SSRF 防护：钉 IP 下载（校验与连接同一地址，防 TOCTOU / 重定向绕过）
  const { buffer } = await safeDownload(absoluteUrl);
  await writeFile(filePath, buffer);

  return filePath;
}

/**
 * 生成 ASS 字幕文件（取代旧 SRT）。
 *
 * 改用 ASS 是为支持「每条字幕独立精确定位」：ASS 事件可写内联标签
 * {\pos(x,y)}（像素绝对定位），SRT 无此能力（位置只能靠九宫格对齐）。
 *
 * 坐标系：PlayResX/Y = 实际画面宽高（quality.width/height），事件用
 * \pos(x*W, y*H) 把归一化坐标还原为像素——与预览端百分比定位同一坐标系，
 * 配合 \an5（中心锚点）对应预览的 translate(-50%,-50%)，确保导出=预览。
 *
 * 时轴对齐关键：字幕起止时间必须用「实测片段有效时长」（effDurations，
 * 按 scenes 顺序 index 对齐），而非从 scene.duration/speed 重算——因为
 * flow2api/Veo 返回的视频真实时长常与 DB 声明的 scene.duration 不符，
 * 若用声明值算时轴，字幕会与画面/配音逐镜累积错位。
 */
async function generateSubtitleFile(
  scenes: SceneMedia[],
  effDurations: number[],
  outputPath: string,
  width: number,
  height: number,
  subtitleStyle?: SubtitleStyle,
  subtitlePositions?: SubtitlePosition[]
): Promise<string> {
  const events: string[] = [];
  let currentTime = 0;

  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    // 字幕时轴用「实测有效时长」（变速+真实视频长度后），与画面/配音对齐
    const effDuration = effDurations[i];
    const text = scene.dialogue || scene.narration;
    if (text) {
      // 该分镜生效坐标（覆盖优先，否则全局默认）→ 像素中心点。
      // 逐句字幕共享同一坐标（位置是分镜级设置，不随句子变化），与预览一致。
      const { x, y } = resolveSubtitleXY(
        scene.id,
        subtitleStyle,
        subtitlePositions
      );
      const px = Math.round(x * width);
      const py = Math.round(y * height);
      // 手动折行到「与预览相同的宽度」——预览端字幕块 maxWidth:90% 画面宽，
      // 用 \pos 后 ASS 的自动换行宽度不可控（从 pos 到边缘），两端换行宽度
      // 不一致 → 行数不同 → 块高不同 → \an5 中心锚点下同一 y 坐标实际占位不同
      // → 长字幕在靠底位置一端溢出画面另一端不溢出（预览≠导出）。这里按
      // 字号估算每行最大字数，主动折行插 \N，与预览换行一致，块高一致。
      const fontPx = resolveSubtitleFontPx(subtitleStyle?.fontSize, height);
      // 中文近似全角等宽（≈fontPx），可用宽度取 90% 画面宽（对齐预览 maxWidth）
      const maxCharsPerLine = Math.max(6, Math.floor((width * 0.9) / fontPx));
      // 入场动效：缺省 fade（与旧行为一致）。slideup 需要画面高换算像素位移。
      const animation: SubtitleAnimation = subtitleStyle?.animation ?? "fade";
      // 逐句化：把整段切成短句 + 按视觉宽度比例分配时间窗（与预览端同源），
      // 每句一条 Dialogue 事件，按所选动效构造 libass 覆盖标签让字幕「活起来」。
      const segments = splitSubtitleSegments(text);
      const windows = allocateSubtitleWindows(segments, effDuration);
      for (const win of windows) {
        const start = formatAssTime(currentTime + win.start);
        const end = formatAssTime(currentTime + win.end);
        const wrapped = wrapSubtitleText(win.text, maxCharsPerLine);
        const eventText = buildAssEventText(
          wrapped,
          animation,
          px,
          py,
          height,
          win.end - win.start
        );
        events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${eventText}`);
      }
    }
    currentTime += effDuration;
  }

  const assContent =
    buildAssHeader(width, height, subtitleStyle) + events.join("\n") + "\n";
  const assPath = path.join(outputPath, "subtitles.ass");
  await writeFile(assPath, assContent, "utf-8");
  return assPath;
}

/**
 * 构建 ASS 文件头（[Script Info] + [V4+ Styles] + [Events] 表头）。
 * 样式从 SubtitleStyle 映射；位置不在此声明（逐事件用 \pos 控制）。
 */
function buildAssHeader(
  width: number,
  height: number,
  style?: SubtitleStyle
): string {
  const s: SubtitleStyle = {
    fontSize: style?.fontSize ?? 24,
    fontColor: style?.fontColor ?? "#FFFFFF",
    outlineColor: style?.outlineColor ?? "#000000",
    outlineWidth: style?.outlineWidth ?? 2,
    position: style?.position ?? "bottom",
    bold: style?.bold ?? false,
    backgroundBox: style?.backgroundBox ?? false,
  };
  // ASS Fontsize 基于 PlayResY(=height)。fontSize 以 1080 基准高定义，
  // 这里按实际成片高线性缩放 → 跨分辨率(480p/720p/1080p)字号视觉占比一致，
  // 且与预览端共用 resolveSubtitleFontPx，保证「预览字号 = 成片字号」。
  const fontSize = resolveSubtitleFontPx(s.fontSize, height);
  const primary = hexToAssColor(s.fontColor);
  const outline = hexToAssColor(s.outlineColor);
  const bold = s.bold ? -1 : 0; // ASS: -1=粗体 0=常规
  // BorderStyle: 3=底框(OpaqueBox) 1=描边(Outline)
  const borderStyle = s.backgroundBox ? 3 : 1;
  // BackColour 用于 OpaqueBox 底框（半透明黑，alpha 80）
  const backColour = "&H80000000";
  // Alignment 用 5（中心）；逐事件 \an5\pos 会覆盖，这里仅作缺省
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},${primary},&H000000FF,${outline},${backColour},${bold},0,0,0,100,100,0,0,${borderStyle},${s.outlineWidth},0,5,20,20,20,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "",
  ].join("\n");
}

/**
 * 转义 ASS 事件文本：大括号会被当标签起止符，需转义；换行转 \N。
 */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/**
 * 构造单条 Dialogue 事件的「入场动效」libass 覆盖标签前缀（不含正文文本）。
 *
 * 与预览端 preview-player 的 CSS keyframes 时序一一对齐（读同一份 SUBTITLE_ANIM），
 * 保证「预览=成片」。各动效标签语义：
 *   - none       {\an5\pos(x,y)}                          仅居中定位，无动效
 *   - fade       {\an5\pos(x,y)\fad(f,f)}                 淡入淡出（旧默认，f=fadeMs）
 *   - slideup    {\an5\move(x,y+dy,x,y,0,ms)\fad(fi,fi)}  从下方 dy 处上滑到位 + 轻淡入
 *                 \move 取代 \pos；dy=round(height*slideUpOffsetRatio)
 *   - pop        {\an5\pos(x,y)\fscx60\fscy60\t(0,ms,\fscx100\fscy100)\fad(fi,fi)}
 *                 从 popStartScale 缩放弹入到 100% + 轻淡入
 * typewriter 不走此函数（逐字符 alpha 揭示在 buildAssEventText 内单独处理）。
 *
 * @param animation 动效类型（typewriter 传入会回退为 none 前缀，正文由调用方逐字构造）
 * @param px,py     字幕中心点像素坐标
 * @param height    成片画面高（slideup 位移换算用）
 * @returns 形如 "{\an5...}" 的覆盖标签前缀
 */
export function buildAssAnimTags(
  animation: SubtitleAnimation,
  px: number,
  py: number,
  height: number
): string {
  const anchor = `\\an5`;
  switch (animation) {
    case "none":
      return `{${anchor}\\pos(${px},${py})}`;
    case "slideup": {
      // 起始点在目标下方 dy 像素处，slideUpMs 内滑到目标点
      const dy = Math.round(height * SUBTITLE_ANIM.slideUpOffsetRatio);
      const fadeIn = Math.round(SUBTITLE_ANIM.slideUpMs * 0.82);
      return `{${anchor}\\move(${px},${py + dy},${px},${py},0,${SUBTITLE_ANIM.slideUpMs})\\fad(${fadeIn},${fadeIn})}`;
    }
    case "pop": {
      const start = Math.round(SUBTITLE_ANIM.popStartScale * 100);
      const fadeIn = Math.round(SUBTITLE_ANIM.popMs * 0.67);
      return `{${anchor}\\pos(${px},${py})\\fscx${start}\\fscy${start}\\t(0,${SUBTITLE_ANIM.popMs},\\fscx100\\fscy100)\\fad(${fadeIn},${fadeIn})}`;
    }
    case "typewriter":
      // 打字机的定位标签同 none，逐字符 alpha 在 buildAssEventText 内拼装
      return `{${anchor}\\pos(${px},${py})}`;
    case "fade":
    default:
      return `{${anchor}\\pos(${px},${py})\\fad(${SUBTITLE_ANIM.fadeMs},${SUBTITLE_ANIM.fadeMs})}`;
  }
}

/**
 * 构造单条 Dialogue 事件的完整正文（覆盖标签 + 转义后的文本）。
 *
 * 非 typewriter：定位/动效标签前缀 + 整段一次性转义文本（保留 wrapSubtitleText
 * 插入的 \n 折行，escapeAssText 会转成 \N）。
 *
 * typewriter：逐字符 alpha 揭示。关键实现约束：
 *   1) 转义顺序——每个字符先各自 escapeAssText 转义，再前置其 {\alpha...} 标签块，
 *      使用户文本里的 `{` `}` 不会破坏标签结构（对齐任务约束「先转义再前置标签」）。
 *   2) 换行处理——wrapSubtitleText 用 \n 折行，先按 \n 切段；段间输出字面 \N 分隔符，
 *      绝不把 \N 这两个字符塞进某个 per-char alpha 块内。
 *   3) 延迟对齐——延迟由 typewriterDelays 基于「含换行槽位」的整段文本计算，
 *      与逐字符索引一一对应（换行也占一个槽），与 lib 侧共享规则完全一致。
 *   4) 不叠加 \fad——打字机靠 alpha 揭示，末尾随窗口结束硬切（避免 libass 下
 *      \fad 与逐字 \alpha 相互作用的边界问题）。
 *
 * @param wrapped        已折行（可能含 \n）但「未转义」的句子文本
 * @param animation      动效类型
 * @param px,py          字幕中心点像素坐标
 * @param height         成片画面高
 * @param windowDurSec   该句时间窗时长（秒），供 typewriter 压缩延迟
 * @returns 完整的 Dialogue 正文字符串（含前缀标签）
 */
export function buildAssEventText(
  wrapped: string,
  animation: SubtitleAnimation,
  px: number,
  py: number,
  height: number,
  windowDurSec: number
): string {
  const tags = buildAssAnimTags(animation, px, py, height);
  if (animation !== "typewriter") {
    return `${tags}${escapeAssText(wrapped)}`;
  }

  // ── 打字机：逐字符 alpha 揭示 ──
  // 延迟按「含换行槽位」的整段折行文本计算，索引与 Array.from(wrapped) 对齐。
  const chars = Array.from(wrapped);
  const delays = typewriterDelays(wrapped, windowDurSec);
  // 单字揭示的 alpha 过渡时长（毫秒）：短促硬揭示，节奏由 delays 主导
  const revealMs = 80;
  let body = "";
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    // 换行符：输出字面 \N 分隔，不包裹 alpha 块（槽位仍占用 → delays 索引已含它）
    if (ch === "\n" || ch === "\r") {
      body += "\\N";
      continue;
    }
    const startMs = Math.round(delays[i] * 1000);
    // 先转义单字符内容，再前置 alpha 标签块（用户文本含 {、} 不会破坏标签）
    const safeChar = escapeAssText(ch);
    body += `{\\alpha&HFF&\\t(${startMs},${startMs + revealMs},\\alpha&H00&)}${safeChar}`;
  }
  return `${tags}${body}`;
}

/**
 * 按每行最大字数手动折行（CJK 全角计 1 宽，ASCII 计 0.5 宽近似），
 * 使导出字幕块的行数/块高与预览端 maxWidth:90% 的换行一致，保证
 * \an5 中心锚点下同一 y 坐标的字幕占位相同（预览=导出）。
 * 保留用户已有的显式换行（先按 \n 分段，再对每段折行）。
 */
export function wrapSubtitleText(
  text: string,
  maxCharsPerLine: number
): string {
  // charWidth 复用 lib/subtitle-segments 的同源实现（CJK=1、ASCII=0.5），
  // 与逐句时间窗分配用同一视觉宽度基准，避免两处启发式漂移。
  const wrapParagraph = (para: string): string => {
    const lines: string[] = [];
    let line = "";
    let w = 0;
    for (const ch of para) {
      const cw = charWidth(ch);
      if (w + cw > maxCharsPerLine && line !== "") {
        lines.push(line);
        line = ch;
        w = cw;
      } else {
        line += ch;
        w += cw;
      }
    }
    if (line) lines.push(line);
    return lines.join("\n");
  };
  return text.split(/\r?\n/).map(wrapParagraph).join("\n");
}

/**
 * 格式化 ASS 时间：H:MM:SS.cs（百分秒，2 位）。
 */
function formatAssTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
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
 * 构建字幕 filter 片段（ASS 文件，样式与定位已内嵌，无需 force_style）。
 * 仅在 includeSubtitles && subtitlePath 不为 null 时调用。
 */
function buildSubtitleFilter(subtitlePath: string): string {
  // 转义路径中的特殊字符（FFmpeg filter 语法要求）
  const escapedPath = subtitlePath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");

  // ASS 文件用 ass filter（样式与逐条 \pos 定位全部内嵌在文件中，无需 force_style）
  return `ass='${escapedPath}'`;
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
  effDurations: number[],
  _tmpDir: string
): Promise<PreparedSticker[]> {
  // 每个分镜的全片起始时间与有效时长——用「实测有效时长」（effDurations，
  // 按 scenes 顺序 index 对齐），与画面/字幕/配音同源，不再从 scene.duration 重算。
  const starts = buildSceneStarts(effDurations);
  const sceneStart: Record<string, number> = {};
  const sceneEffDur: Record<string, number> = {};
  for (let i = 0; i < scenes.length; i += 1) {
    sceneStart[scenes[i].id] = starts[i];
    sceneEffDur[scenes[i].id] = effDurations[i];
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

/** 单分镜片段产物：本地路径 + 实测有效时长（供 xfade/音频累计对齐） */
interface SceneClip {
  path: string;
  /**
   * 片段在成片时间轴上的实测有效时长（秒）。
   * 优先取 ffprobe 到的产物真实时长；探测失败时回退声明值 scene.duration/speed。
   * 视频分镜的真实长度常与 DB 声明的 scene.duration 不符（provider 忽略请求时长），
   * 用实测值可让 xfade / 字幕 / 配音 / BGM / 贴图时轴全部自愈对齐。
   */
  effectiveDuration: number;
}

/**
 * 按「实测有效时长数组」计算每镜在成片时间轴上的起始秒（前缀和）。
 * 与 scenes 顺序 index 对齐：start[i] = 前 i 段有效时长之和。
 * 供字幕 / 配音 adelay / 贴图时间窗共用，保证三者与画面同源对齐。
 */
export function buildSceneStarts(effDurations: number[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const d of effDurations) {
    starts.push(cursor);
    cursor += d;
  }
  return starts;
}

/** 成片总时长 = 各镜实测有效时长之和（BGM atrim/afade out 起点用）。 */
export function sumDurations(effDurations: number[]): number {
  return effDurations.reduce((acc, d) => acc + d, 0);
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
 * ffprobe 产物片段真实时长，失败时回退声明值。
 * 三个分支（视频/图片/黑场）统一收口：黑场/图片是自造时长（应与声明一致，
 * 探测只是确认）；视频分支尤为关键——真实视频长度常≠声明 scene.duration，
 * 用实测值让后续 xfade/字幕/配音/BGM/贴图时轴自愈对齐。
 */
async function probeClipDuration(
  clipPath: string,
  fallback: number
): Promise<number> {
  try {
    const probed = await getMediaDuration(clipPath);
    return probed > 0 ? probed : fallback;
  } catch {
    // 探测失败（ffprobe 缺失/损坏产物）不阻塞导出，回退声明时长
    return fallback;
  }
}

/**
 * 将单个分镜转换为视频片段。
 * 支持滤镜（FX）与变速（speed）：变速同时作用于画面（setpts）与音轨（atempo）。
 * 片段产出后 ffprobe 其真实时长作为 effectiveDuration 返回，供后续 xfade offset、
 * 字幕、音频 adelay、BGM、贴图时间窗累计对齐（不再盲信 DB 声明的 scene.duration）。
 */
async function sceneToVideoClip(
  scene: SceneMedia,
  outputDir: string,
  options: ExportOptions
): Promise<SceneClip> {
  const { width, height } = ASPECT_RATIOS[options.aspectRatio];
  const outputPath = path.join(outputDir, `scene_${scene.order}.mp4`);

  const { effect, speed } = resolveSceneEffect(scene.id, options.sceneEffects);
  // 声明有效时长 = 原始时长 / 倍速；仅作图片/黑场的生成参数与探测失败兜底。
  const declaredDuration = scene.duration / speed;
  const vf = buildClipVideoFilter(width, height, effect, speed);

  // 如果有视频，直接使用
  if (scene.videoUrl) {
    const videoPath = await downloadFile(
      scene.videoUrl,
      `video_${scene.order}.mp4`
    );

    // 视频带音轨：用 filter_complex 同时处理画面与音频变速。
    // 不再用 -t scene.duration 截断——DB 声明时长常短于真实视频长度，硬截会
    // 砍掉真实内容并让时轴错乱；真实视频长度即分镜时长，变速后由 ffprobe 实测。
    const filterComplex =
      speed !== 1
        ? `[0:v]${vf}[v];[0:a]${buildAtempoChain(speed).join(",")}[a]`
        : `[0:v]${vf}[v]`;
    const args = [
      "-i",
      videoPath,
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
    // 声明值除以倍速作兜底：变速后真实长度理论上 = 源真实长度 / speed
    const effectiveDuration = await probeClipDuration(
      outputPath,
      declaredDuration
    );
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
      declaredDuration.toString(),
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
    // 图片是自造时长，探测只是确认（应≈declaredDuration）
    const effectiveDuration = await probeClipDuration(
      outputPath,
      declaredDuration
    );
    return { path: outputPath, effectiveDuration };
  }

  // 生成黑色背景视频
  await runFFmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:d=${declaredDuration}`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-y",
    outputPath,
  ]);

  // 黑场是自造时长，探测只是确认（应≈declaredDuration）
  const effectiveDuration = await probeClipDuration(
    outputPath,
    declaredDuration
  );
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
    //
    // 有限并发：每个 sceneToVideoClip = 下载(IO) + FFmpeg(CPU)。原先纯串行
    // （20 镜 ≈ 100s+）。这里按 CLIP_CONCURRENCY 分批并发，让 IO 重叠、CPU 跑满
    // 多核，同时避免全并发同时 spawn 几十个 ffmpeg 进程导致 OOM/CPU 过载。
    // 关键：clips 必须按原 index 归位（成片分镜顺序），不能用完成顺序。
    const CLIP_CONCURRENCY = 3;
    const clips: SceneClip[] = new Array(scenes.length);
    let doneCount = 0;
    for (let i = 0; i < scenes.length; i += CLIP_CONCURRENCY) {
      const batch = scenes.slice(i, i + CLIP_CONCURRENCY);
      await Promise.all(
        batch.map(async (scene, j) => {
          const clip = await sceneToVideoClip(scene, tmpDir, options);
          clips[i + j] = clip; // 按原始 index 归位，保持分镜顺序
          doneCount += 1;
          onProgress?.(Math.round((doneCount / scenes.length) * 50));
        })
      );
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
      // 配音 adelay 累计用「实测有效时长」（effDurations，按 scenes index 对齐），
      // 与视频片段在成片时间轴上同源对齐——不再从 scene.duration/speed 重算，
      // 避免真实视频比声明长/短时配音逐镜累积错位。
      let currentTime = 0;
      for (let i = 0; i < scenes.length; i += 1) {
        const scene = scenes[i];
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
        currentTime += effDurations[i];
      }
    }

    // 4.5 准备背景音乐（BGM）：下载到本地并预备混音参数。
    // 总时长 = 各分镜实测有效时长之和（与配音/字幕/画面同源），
    // 供 BGM 的 atrim 截断与 afade out 起点使用。
    const bgm = options.backgroundMusic;
    let bgmPath: string | null = null;
    let bgmTotalDuration = 0;
    if (bgm?.enabled && bgm.url) {
      bgmTotalDuration = sumDurations(effDurations);
      try {
        bgmPath = await downloadFile(absolutizeUrl(bgm.url), "bgm_track.mp3");
      } catch (err) {
        // BGM 下载失败不阻塞主流程，记录后跳过（成片仍有对白）
        log.warn("BGM 下载失败，跳过背景音乐:", err);
        bgmPath = null;
      }
    }
    const hasBgm = bgmPath !== null;

    onProgress?.(70);

    // 5. 生成字幕（ASS：时轴随变速对齐 + 逐分镜 \pos 精确定位）
    // quality 提前解析（纯函数无副作用）：ASS 的 PlayResX/Y 与 \pos 像素需画面宽高。
    // 最终画幅按「质量档位 + 项目画幅」派生（含 bitrate），下游 scale/pad/字幕定位
    // 全部读 quality.width/height/bitrate，故只需在此改绑定，其余消费点自动对齐。
    const quality = resolveOutputDimensions(
      options.quality,
      options.aspectRatio
    );
    let subtitlePath: string | null = null;
    if (options.includeSubtitles) {
      subtitlePath = await generateSubtitleFile(
        scenes,
        effDurations,
        tmpDir,
        quality.width,
        quality.height,
        options.subtitleStyle,
        options.subtitlePositions
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
        log.warn("水印 logo 下载失败，跳过水印:", err);
        logoPath = null;
      }
    }

    // 6.5 准备贴图（按分镜时间窗 overlay，时间窗用实测有效时长对齐）
    const preparedStickers =
      options.stickers && options.stickers.length > 0
        ? await prepareStickers(options.stickers, scenes, effDurations, tmpDir)
        : [];

    // 7. 最终合成（quality 已在第 5 步提前解析，供 ASS 与编码共用）
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

      // 先添加音频输入；BGM 与 overlay 图片输入排在音频之后
      ffmpegArgs.push(...audioInputs);
      const audioCount = audioInputs.length / 2;
      // BGM 作为额外 -i，排在所有配音轨之后；记录其输入索引
      let bgmInputIndex = -1;
      if (hasBgm && bgmPath) {
        ffmpegArgs.push("-i", bgmPath);
        bgmInputIndex = 1 + audioCount;
      }
      // overlay 图片输入索引：在 merged([0]) + 配音轨 + BGM(占 1 位) 之后
      let nextInputIndex = 1 + audioCount + (hasBgm ? 1 : 0);

      // ── 视频基链 ────────────────────────────────────────────────────
      // [0:v] → scale+pad → 可选字幕 → [base]
      let videoChain = `[0:v]scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2:black`;
      if (subtitlePath) {
        videoChain += `,${buildSubtitleFilter(subtitlePath)}`;
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
      // 音频 adelay 的索引从 1 开始（音频输入在 merged 之后），不受 logo 影响。
      const voiceLabels = audioFilters.map((_, i) => `[a${i}]`);
      let audioOutLabel: string | null = null;
      if (hasBgm && bgmInputIndex >= 0) {
        // 有 BGM：先放对白 adelay，再用 buildBgmFilter 处理 BGM + 混音
        filterParts.push(...audioFilters);
        const bgmBuilt = buildBgmFilter(
          bgm!,
          bgmInputIndex,
          bgmTotalDuration,
          voiceLabels
        );
        filterParts.push(...bgmBuilt.filters);
        audioOutLabel = bgmBuilt.outLabel;
      } else if (audioFilters.length > 0) {
        // 无 BGM：仅对白配音 amix（原行为）
        filterParts.push(...audioFilters);
        const mixInputs = voiceLabels.join("");
        filterParts.push(
          `${mixInputs}amix=inputs=${audioFilters.length}[aout]`
        );
        audioOutLabel = "[aout]";
      }

      ffmpegArgs.push("-filter_complex", filterParts.join(";"));

      // ── map 输出流 ──────────────────────────────────────────────────
      ffmpegArgs.push("-map", "[outv]");
      if (audioOutLabel) {
        ffmpegArgs.push("-map", audioOutLabel);
      }
      // BGM loop=longest 时用总时长兜底截断，防 amix duration 拖尾
      if (hasBgm) {
        ffmpegArgs.push("-t", bgmTotalDuration.toFixed(3));
      }

      // ── 编码参数（按 format 选编码器，webm≠mp4） ─────────────────────
      ffmpegArgs.push(
        ...buildOutputEncodingArgs(options.format, quality.bitrate, outputPath)
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
      const audioCountNoWm = audioInputs.length / 2;
      // BGM 作为额外 -i，排在所有配音轨之后
      let bgmIdxNoWm = -1;
      if (hasBgm && bgmPath) {
        ffmpegArgs.push("-i", bgmPath);
        bgmIdxNoWm = 1 + audioCountNoWm;
      }

      // 构建视频滤镜（-vf 路径）
      let videoFilter = `scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2:black`;

      // 添加字幕（带可选样式）
      if (subtitlePath) {
        videoFilter += `,${buildSubtitleFilter(subtitlePath)}`;
      }

      ffmpegArgs.push("-vf", videoFilter);

      // 音频混合（单独的 filter_complex，与 -vf 共存）
      const voiceLabelsNoWm = audioFilters.map((_, i) => `[a${i}]`);
      if (hasBgm && bgmIdxNoWm >= 0) {
        // 有 BGM：对白 adelay + buildBgmFilter 处理 BGM + 混音
        const bgmBuilt = buildBgmFilter(
          bgm!,
          bgmIdxNoWm,
          bgmTotalDuration,
          voiceLabelsNoWm
        );
        const audioParts =
          audioFilters.length > 0
            ? [...audioFilters, ...bgmBuilt.filters]
            : bgmBuilt.filters;
        ffmpegArgs.push(
          "-filter_complex",
          audioParts.join(";"),
          "-map",
          "0:v",
          "-map",
          bgmBuilt.outLabel,
          // BGM loop=longest 时用总时长兜底截断，防拖尾
          "-t",
          bgmTotalDuration.toFixed(3)
        );
      } else if (audioFilters.length > 0) {
        // 无 BGM：仅对白配音 amix（原行为）
        const mixInputs = voiceLabelsNoWm.join("");
        ffmpegArgs.push(
          "-filter_complex",
          `${audioFilters.join(";")}; ${mixInputs}amix=inputs=${audioFilters.length}[aout]`,
          "-map",
          "0:v",
          "-map",
          "[aout]"
        );
      }

      // 输出设置（按 format 选编码器，webm≠mp4）
      ffmpegArgs.push(
        ...buildOutputEncodingArgs(options.format, quality.bitrate, outputPath)
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
