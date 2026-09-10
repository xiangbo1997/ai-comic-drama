/**
 * 视频合成服务
 * 使用 FFmpeg 将多个分镜合成为完整视频
 */

import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import os from "os";
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
  SceneMotion,
  SceneImpact,
  BackgroundMusic,
  SceneSfx,
} from "@/types/export-style";
import {
  resolveSubtitleXY,
  resolveSubtitleFontPx,
  EMPHASIS_STYLE,
} from "@/types/export-style";
// 混合出片成本路由：图片分镜默认运镜先按导演 cameraMovement 派生（双端同构单一真源）。
import { resolveDefaultMotion } from "@/lib/render-mode";
// 全片 LUT 调色（批6）：id → .cube 预设白名单，导出端 lut3d 统一色调。
import { type ColorGrade } from "@/lib/color-grade";
// 片头/片尾卡（批6）：卡片文字行角色 → 卡片字幕样式映射。
import { type CardLine } from "@/lib/title-cards";
// 逐句字幕切分 + 时间窗分配（与预览端 preview-player 共用同一权威实现，
// 保证「逐句显示 + 淡入淡出」在预览与成片两端时轴一致）。
import {
  buildSubtitleSourceText,
  splitSubtitleSegments,
  allocateSubtitleWindows,
} from "@/lib/subtitle-segments";
import type { SubtitleAnimation } from "@/types/export-style";

// ── 已提取的纯函数构建器（结构拆分，行为不变）──────────────────────────
// 运镜 / 冲击：video-synthesis/filters/motion.ts
import { buildClipVideoFilter } from "@/services/video-synthesis/filters/motion";
// 音频（atempo / BGM / SFX / 终混）：video-synthesis/filters/audio.ts
import {
  buildAtempoChain,
  buildFinalAudioChain,
  buildSfxFilters,
  buildSfxSchedule,
  type SfxScheduleItem,
} from "@/services/video-synthesis/filters/audio";
// 调色 / 字幕 / 水印滤镜串：video-synthesis/filters/color.ts
import {
  FX_FILTERS,
  buildColorGradeFilter,
  buildSubtitleFilter,
  getWatermarkOverlayExpr,
} from "@/services/video-synthesis/filters/color";
// ASS 字幕构建：video-synthesis/ass/builder.ts
import {
  buildAssEventText,
  buildAssHeader,
  buildCardEvents,
  buildDisclosureEvents,
  formatAssTime,
  wrapSubtitleText,
} from "@/services/video-synthesis/ass/builder";
// AI 生成内容提示标识（合规，广电总局令第 16 号第三十四条）：
// 与预览端共用 lib/ai-disclosure 的配置解析与几何/时间窗契约。
import {
  resolveAiDisclosure,
  type AiDisclosure,
  type ResolvedAiDisclosure,
} from "@/lib/ai-disclosure";
// FFmpeg 进程执行 + URL 绝对化 + 防 SSRF 下载：video-synthesis/ffmpeg-run.ts
import {
  absolutizeUrl,
  downloadFile,
  runFFmpeg,
} from "@/services/video-synthesis/ffmpeg-run";
// 独立媒体操作（探测时长等）：video-synthesis/media-ops.ts
import { getMediaDuration } from "@/services/video-synthesis/media-ops";

export type {
  SubtitleStyle,
  SubtitlePosition,
  Watermark,
  Sticker,
  Transition,
  SceneEffect,
  SceneMotion,
  SceneImpact,
  BackgroundMusic,
  SceneSfx,
};

// 拆分前这些符号定义在本文件并对外导出（部分供测试/预览端复用）。
// 实现已移入 video-synthesis/ 子模块，此处原样再导出以保持公开接口不变。
export {
  buildAssAnimTags,
  buildAssEventText,
  wrapSubtitleText,
} from "@/services/video-synthesis/ass/builder";
export { buildSfxSchedule } from "@/services/video-synthesis/filters/audio";
export type { SfxScheduleItem } from "@/services/video-synthesis/filters/audio";
// 独立媒体操作（探测 / 裁剪 / 抽帧 / 拼接）——多处调用方按原路径导入，故原样再导出。
export {
  getMediaDuration,
  trimVideoToDuration,
  extractLastFrame,
  concatVideos,
  concatAudioBuffers,
  probeMediaDurationFromUrl,
} from "@/services/video-synthesis/media-ops";

export interface SceneMedia {
  id: string;
  order: number;
  duration: number;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  dialogue?: string | null;
  narration?: string | null;
  /**
   * 导演运镜（13 值枚举之一，与 CAMERA_MOVEMENTS 对齐）。
   * 图片分镜无显式 SceneEffect.motion 时，默认运镜先按此值经 resolveDefaultMotion 派生，
   * 映射不到再回落 zoomIn（尊重导演意图，双端同构走 lib/render-mode 单一真源）。
   */
  cameraMovement?: string | null;
  /**
   * 片头/片尾卡（批6 成片包装）：非空时该分镜是卡片合成分镜，
   * 字幕层不走对白逻辑，改为按行角色发卡片文字事件（见 generateSubtitleFile）。
   * 由 export/route.ts 用 buildTitleCards 构造后注入 sceneMediaList 首/尾。
   */
  card?: { kind: "title" | "end"; lines: CardLine[] } | null;
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
  /**
   * 音效（SFX）列表（按 sceneId + 镜内偏移触发），作为「第三音频层」混入。
   * 缺省或空时不加音效；导出层级 voice > SFX > BGM > ambient。
   */
  sfx?: SceneSfx[];
  /**
   * 转场处自动补 whoosh 音效。
   * 契约：仅在「本次导出携带 sfx 配置」（options.sfx !== undefined）时默认开启——
   * 存量项目（无 sfx 配置）零回归、绝不自动加音效。显式传 false 可在有 sfx 配置
   * 时仍关闭自动转场音效。
   */
  autoTransitionSfx?: boolean;
  /**
   * 金句花字分镜 id 列表（批6）：命中且有对白的分镜，其字幕改用大字号强调色
   * pop 花字样式（Emphasis），动效强制 EMPHASIS_STYLE.animation，其余分镜行为不变。
   * 缺省或空时无花字（存量零回归）。
   */
  emphasisSceneIds?: string[];
  /**
   * 全片 LUT 调色（批6）：enabled 且预设合法时，终混在 scale+pad 之后、字幕之前
   * 插一记 lut3d 统一全片色调；缺省或未启用时不插（预览与导出存在近似色差，
   * 显式开启才生效）。
   */
  colorGrade?: ColorGrade;
  /**
   * AI 生成内容提示标识（合规）——《微短剧管理办法》（广电总局令第 16 号，
   * 2026-09-01 施行）第三十四条要求「每集明显位置添加提示标识」。
   *
   * ⚠️ 缺省语义与其他可选功能相反：**缺省即启用默认标识**（法定要求，
   * 存量项目不能静默导出成无标识成片）。仅 enabled:false 显式关闭。
   * 具体文案/位置/字号/时长为可配置默认值，法规原文未规定量化参数。
   */
  aiDisclosure?: AiDisclosure;
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
 * 解析某分镜的画面调节配置（滤镜 + 变速 + 运镜 + 冲击），带边界校验。
 *
 * motion/impact 为可选：缺省时返回 null，运镜的「图片分镜默认 zoomIn」契约由
 * 调用点（sceneToVideoClip 的图片分支）在 motion===undefined 时兜底，此处只忠实
 * 回传用户显式配置（含显式 null = 用户关掉了默认运镜）。
 */
function resolveSceneEffect(
  sceneId: string,
  effects?: SceneEffect[]
): {
  effect: string | null;
  speed: number;
  motion: SceneMotion | null | undefined;
  impact: SceneImpact | null;
} {
  const found = effects?.find((e) => e.sceneId === sceneId);
  const effectId = found?.effect;
  const effect = effectId && FX_FILTERS[effectId] ? FX_FILTERS[effectId] : null;
  const rawSpeed = found?.speed;
  const speed =
    rawSpeed != null && !isNaN(Number(rawSpeed))
      ? Math.min(4, Math.max(0.25, Number(rawSpeed)))
      : 1;
  // motion：区分「未配置」（undefined，触发图片默认 zoomIn）与「显式 null」（关闭默认）
  const motion = found ? (found.motion ?? null) : undefined;
  const impact = found?.impact ?? null;
  return { effect, speed, motion, impact };
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
 *
 * 批6 成片包装：
 * - 卡片分镜（scene.card 非空）不走对白逻辑，改发卡片文字事件（buildCardEvents）；
 * - 金句花字分镜（id ∈ emphasisSceneIds 且有对白）用 Emphasis 样式 + 强制 pop 动效。
 */
async function generateSubtitleFile(
  scenes: SceneMedia[],
  effDurations: number[],
  outputPath: string,
  width: number,
  height: number,
  subtitleStyle?: SubtitleStyle,
  subtitlePositions?: SubtitlePosition[],
  voiceDurations?: (number | undefined)[],
  emphasisSceneIds?: string[],
  /**
   * 对白/旁白字幕开关。false 时只产出 AI 标识事件（合规标识不随字幕开关消失）——
   * 见 synthesizeVideoToPath 里 needSubtitleFile 的说明。
   */
  includeDialogueSubtitles: boolean = true,
  /** AI 生成提示标识（已解析）；未启用时不产出标识事件 */
  disclosure?: ResolvedAiDisclosure
): Promise<string> {
  const events: string[] = [];
  let currentTime = 0;
  // 金句花字分镜集合（O(1) 命中判断）
  const emphasisSet = new Set(emphasisSceneIds ?? []);

  for (let i = 0; i < scenes.length; i += 1) {
    // 字幕关闭时跳过全部对白/卡片事件，仅保留下方 AI 标识事件
    if (!includeDialogueSubtitles) break;
    const scene = scenes[i];
    // 字幕时轴用「实测有效时长」（变速+真实视频长度后），与画面/配音对齐
    const effDuration = effDurations[i];

    // 卡片分镜：不走对白字幕，改发片头/片尾卡文字事件（整卡时长内显示）
    if (scene.card) {
      events.push(
        ...buildCardEvents(scene.card, currentTime, effDuration, width, height)
      );
      currentTime += effDuration;
      continue;
    }

    // 配音真实音频秒长（有则字幕逐句节奏按它走完 + 末句停驻到镜末，见
    // allocateSubtitleWindows 的 voiceDuration 语义）
    const voiceDuration = voiceDurations?.[i];
    // 字幕源文本走单一真源：旁白 + 对白都显示，与配音侧两段合成对等。
    // 此前是 `dialogue || narration`：旁白无字幕 + 对白字幕按「旁白+对白」总音频
    // 长分窗导致整体错位。
    const text = buildSubtitleSourceText(scene);
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
      // 金句花字分镜：仅有对白时生效（用 scene.dialogue 判定，旁白不上花字）。
      const isEmphasis =
        emphasisSet.has(scene.id) && Boolean(scene.dialogue?.trim());
      // 花字用 Emphasis 样式（大字号），字号随之放大，需按放大后字号折行。
      const effectiveFontSize = isEmphasis
        ? (subtitleStyle?.fontSize ?? 24) * EMPHASIS_STYLE.fontScale
        : subtitleStyle?.fontSize;
      // 手动折行到「与预览相同的宽度」——预览端字幕块 maxWidth:90% 画面宽，
      // 用 \pos 后 ASS 的自动换行宽度不可控（从 pos 到边缘），两端换行宽度
      // 不一致 → 行数不同 → 块高不同 → \an5 中心锚点下同一 y 坐标实际占位不同
      // → 长字幕在靠底位置一端溢出画面另一端不溢出（预览≠导出）。这里按
      // 字号估算每行最大字数，主动折行插 \N，与预览换行一致，块高一致。
      const fontPx = resolveSubtitleFontPx(effectiveFontSize, height);
      // 中文近似全角等宽（≈fontPx），可用宽度取 90% 画面宽（对齐预览 maxWidth）
      const maxCharsPerLine = Math.max(6, Math.floor((width * 0.9) / fontPx));
      // 入场动效：花字强制 EMPHASIS_STYLE.animation（pop，视觉签名统一，忽略全局）；
      // 其余分镜缺省 fade（与旧行为一致）。slideup 需要画面高换算像素位移。
      const animation: SubtitleAnimation = isEmphasis
        ? EMPHASIS_STYLE.animation
        : (subtitleStyle?.animation ?? "fade");
      // 花字用 Emphasis 样式，其余用 Default
      const styleName = isEmphasis ? "Emphasis" : "Default";
      // 逐句化：把整段切成短句 + 按视觉宽度比例分配时间窗（与预览端同源），
      // 每句一条 Dialogue 事件，按所选动效构造 libass 覆盖标签让字幕「活起来」。
      const segments = splitSubtitleSegments(text);
      const windows = allocateSubtitleWindows(
        segments,
        effDuration,
        voiceDuration
      );
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
        events.push(
          `Dialogue: 0,${start},${end},${styleName},,0,0,0,,${eventText}`
        );
      }
    }
    currentTime += effDuration;
  }

  // AI 生成提示标识（合规，第三十四条）：时间窗覆盖全片/片头，故用全片总时长
  // （实测有效时长之和，与画面同轴）。Layer 1 保证不被正文字幕遮挡。
  if (disclosure?.enabled) {
    const totalSec = effDurations.reduce((sum, d) => sum + (d || 0), 0);
    events.push(...buildDisclosureEvents(disclosure, totalSec, width, height));
  }

  const assContent =
    buildAssHeader(width, height, subtitleStyle, disclosure) +
    events.join("\n") +
    "\n";
  const assPath = path.join(outputPath, "subtitles.ass");
  await writeFile(assPath, assContent, "utf-8");
  return assPath;
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
  tmpDir: string
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
      const localPath = await downloadFile(
        st.imageUrl,
        `sticker_${idx}.png`,
        tmpDir
      );
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

  const { effect, speed, motion, impact } = resolveSceneEffect(
    scene.id,
    options.sceneEffects
  );
  // 声明有效时长 = 原始时长 / 倍速；仅作图片/黑场的生成参数与探测失败兜底。
  const declaredDuration = scene.duration / speed;

  // 视频分镜的滤镜链：无运镜（视频自带运动），仅冲击（重震/闪白/定格）。
  // freeze 用镜内 trim+tpad 定格，需传视频有效时长——但视频真实长度常≠声明值，
  // 这里用 declaredDuration 作近似（freeze 仅镜尾 0.5s，误差不影响观感）。
  const vf = buildClipVideoFilter(width, height, effect, speed, {
    isImage: false,
    motion: null,
    impact,
    durationSec: declaredDuration,
  });

  // 如果有视频，直接使用
  if (scene.videoUrl) {
    const videoPath = await downloadFile(
      scene.videoUrl,
      `video_${scene.order}.mp4`,
      outputDir
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
      `image_${scene.order}.jpg`,
      outputDir
    );

    // 图片场景：滤镜照常应用，但变速对静态图无意义（画面不动），
    // 用有效时长直接 -t 即可（无需 setpts）。
    //
    // 冲击窗坐标系：此分支不挂 setpts，源轴即成片轴（-t 已是 declaredDuration =
    // duration/speed），故 speed 传 1——冲击窗无需换算，直接是成片轴常量窗。
    // 若哪天图片分支改成「按原时长生成 + setpts 压缩」，这里必须改传 speed。
    //
    // Ken Burns 默认契约：图片分镜是「-loop 1 死图」的幻灯片感重灾区，故
    //   - motion===undefined（用户从未配运镜）→ 默认运镜先按导演 cameraMovement 派生
    //     （resolveDefaultMotion，映射不到再回落 zoomIn 杀死图感），尊重导演意图；
    //   - motion===null（用户显式关运镜）→ 不加运镜（纯静图，尊重用户）；
    //   - motion 有值 → 用该运镜。
    const imgMotion: SceneMotion | null =
      motion === undefined
        ? (resolveDefaultMotion(scene.cameraMovement) ?? "zoomIn")
        : motion;
    const imgVf = buildClipVideoFilter(width, height, effect, 1, {
      isImage: true,
      motion: imgMotion,
      impact,
      durationSec: declaredDuration,
    });
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
 * 导出进度回调。返回 Promise 时合成端会 await——调用方常在回调里写库，
 * 不等它就会出现「进度写在完成写之后落地、把 output 里的 videoUrl 覆盖掉」
 * 的竞态（导出显示成功但拿不到视频）。
 */
export type ProgressCallback = (progress: number) => void | Promise<void>;

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
  onProgress?: ProgressCallback
): Promise<Buffer> {
  return synthesizeVideoToPath(
    scenes,
    options,
    async (outputPath) => {
      const { readFile } = await import("fs/promises");
      return readFile(outputPath);
    },
    onProgress
  );
}

/**
 * 合成完整视频并把产物路径交给 consume 消费，consume 返回后才清理临时目录。
 *
 * 与 synthesizeVideo 的区别：不把成片读进内存。成片动辄数百 MB，readFile
 * 会在 node 堆上驻留同等大小 Buffer，并发导出直接 OOM；调用方拿到路径后可
 * 走 storage.uploadFileFromPath 流式上传。consume 必须在返回前用完该路径
 * （finally 会 rm 掉整个临时目录）。
 */
export async function synthesizeVideoToPath<T>(
  scenes: SceneMedia[],
  options: ExportOptions,
  consume: (outputPath: string) => Promise<T>,
  onProgress?: ProgressCallback
): Promise<T> {
  // per-run 独占目录（含随机后缀）：Date.now() 单独用在同毫秒并发下会撞名，
  // 而所有素材文件名是固定的（video_0.mp4 等），撞目录即内容串台。
  const tmpDir = path.join(
    os.tmpdir(),
    "ai-comic-export",
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
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
          await onProgress?.(Math.round((doneCount / scenes.length) * 50));
        })
      );
    }
    const videoClips = clips.map((c) => c.path);
    // 成片时间轴上各片段的有效时长（变速后），用于 xfade offset 与音频累计对齐
    const effDurations = clips.map((c) => c.effectiveDuration);

    // 是否有存储的转场配置（用户/脚本已显式设置）。
    // 剪辑节奏回归（批2）：漫剧专业惯例 ~90% 硬切，全片叠化=业余「AI味PPT」。
    // 故「无任何存储配置」时默认硬切（none）而非旧 fade 0.3s；一旦有存储配置就
    // 逐项尊重（缺项仍回落 fade，保持存量项目导出行为不变——兼容铁律）。
    const hasStoredTransitions =
      Array.isArray(options.transitions) && options.transitions.length > 0;

    // 解析每个衔接处（k = 第 k 与 k+1 分镜之间）的转场类型与时长。
    // 转场时长上限不超过相邻两段有效时长的一半，避免 offset 越界导致 xfade 报错。
    const resolveTransition = (
      k: number
    ): { type: TransitionType; duration: number } => {
      const t = options.transitions?.[k];
      const rawType = t?.type;
      // 缺省转场：有存储配置时回落 fade（存量兼容）；无存储配置时回落 none（硬切）。
      const fallbackType: TransitionType = hasStoredTransitions
        ? "fade"
        : "none";
      const resolvedRawType = rawType ?? fallbackType;
      const type: TransitionType =
        resolvedRawType && XFADE_TYPES.has(resolvedRawType)
          ? resolvedRawType
          : "fade";
      // "none"（硬切）用极短淡化≈0.04s 近似，统一走 xfade 管线
      const isNone = resolvedRawType === "none";
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

    await onProgress?.(60);

    // 4. 处理音频
    const audioInputs: string[] = [];
    const audioFilters: string[] = [];
    let audioIndex = 0;
    // 各镜配音真实音频秒长（按 scenes index 对齐），供字幕逐句节奏对齐（批3）：
    // 字幕跟着语音走完 + 末句停驻到镜末，不再摊到语音结束后的静默画面。
    // 无配音 / 未包含音频时该镜为 undefined，字幕退化为按 effDuration 分配（零回归）。
    const voiceDurations: (number | undefined)[] = new Array(
      scenes.length
    ).fill(undefined);

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
            `audio_${scene.order}.mp3`,
            tmpDir
          );
          audioInputs.push("-i", audioPath);
          // 配音变速：该镜配了 speed 时，画面已被 setpts（视频镜）或 -t 压缩
          // （图片镜，declaredDuration = duration/speed），配音是成片阶段的独立
          // 输入流，必须在此同步 atempo，否则「画面 2 倍速、配音原速」→ 音画失步
          // 且配音溢出到下一镜。视频镜片段内的 [0:a]atempo 只作用于视频自带音轨，
          // 与这条 TTS 配音流无关，故两处都要挂。
          const { speed: voiceSpeed } = resolveSceneEffect(
            scene.id,
            options.sceneEffects
          );
          const delayMs = Math.round(currentTime * 1000);
          const tempoChain =
            voiceSpeed !== 1 ? buildAtempoChain(voiceSpeed) : [];
          // 先变速再 adelay：atempo 只压缩流自身长度，adelay 的偏移量是成片时间轴
          // 绝对值，顺序颠倒会把延迟本身也一起压缩掉。
          const chain = [...tempoChain, `adelay=${delayMs}|${delayMs}`].join(
            ","
          );
          audioFilters.push(`[${audioIndex + 1}:a]${chain}[a${audioIndex}]`);
          audioIndex++;
          // 探测配音真实时长供字幕对齐（探测失败留 undefined，字幕回退按镜时长分配）。
          // 变速后成片里的配音实长 = 源实长 / speed，字幕逐句节奏须按变速后的值分配，
          // 否则末句会被推到镜外（与 declaredDuration = duration/speed 同公式）。
          try {
            const probed = await getMediaDuration(audioPath);
            if (probed > 0) voiceDurations[i] = probed / voiceSpeed;
          } catch {
            // ffprobe 失败不阻塞导出，该镜字幕退化为按 effDuration 分配
          }
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
        bgmPath = await downloadFile(
          absolutizeUrl(bgm.url),
          "bgm_track.mp3",
          tmpDir
        );
      } catch (err) {
        // BGM 下载失败不阻塞主流程，记录后跳过（成片仍有对白）
        log.warn("BGM 下载失败，跳过背景音乐:", err);
        bgmPath = null;
      }
    }
    const hasBgm = bgmPath !== null;

    // 4.6 准备音效（SFX）：解析时间表 → 下载到本地 → 预备第三音频层混音。
    //
    // 触发时刻用 buildSceneStarts(effDurations)（与配音/字幕/BGM 同源的非重叠
    // 时间轴，转场重叠误差 ~0.3s 可忽略）。转场自动 whoosh：仅当本次导出携带
    // sfx 配置（options.sfx !== undefined）且未显式关（autoTransitionSfx !== false）
    // 时，在「显式配置的非硬切转场」（fade/fadeblack/fadewhite 等，非 none）的衔接
    // 点补一记 whoosh——存量项目（无 sfx 配置）零回归。
    const sceneStarts = buildSceneStarts(effDurations);
    const sceneIds = scenes.map((s) => s.id);
    const wantAutoTransitionSfx =
      options.sfx !== undefined && options.autoTransitionSfx !== false;
    const transitionSfxPoints: number[] = [];
    if (wantAutoTransitionSfx && Array.isArray(options.transitions)) {
      for (let k = 0; k < scenes.length - 1; k += 1) {
        const t = options.transitions[k];
        // 只有「显式配置了非 none 转场」才补 whoosh（硬切/缺省不补，避免噪音泛滥）
        if (t && t.type && t.type !== "none" && sceneStarts[k + 1] != null) {
          transitionSfxPoints.push(sceneStarts[k + 1]);
        }
      }
    }
    const sfxSchedule = buildSfxSchedule(
      options.sfx,
      sceneStarts,
      sceneIds,
      transitionSfxPoints
    );
    // 下载各音效到本地（失败项置 null，后续按索引对齐过滤跳过 → 优雅降级）
    const sfxLocalPaths: (string | null)[] = [];
    for (let i = 0; i < sfxSchedule.length; i += 1) {
      try {
        const p = await downloadFile(
          absolutizeUrl(sfxSchedule[i].url),
          `sfx_${i}.mp3`,
          tmpDir
        );
        sfxLocalPaths.push(p);
      } catch (err) {
        log.warn(`SFX 下载失败，跳过该音效 (${sfxSchedule[i].url}):`, err);
        sfxLocalPaths.push(null);
      }
    }
    // 仅保留成功下载的音效（ffmpeg 输入用紧凑列表，与 buildSfxFilters 输入索引对齐）
    const preparedSfx = sfxSchedule
      .map((item, i) => ({ item, localPath: sfxLocalPaths[i] }))
      .filter((x): x is { item: SfxScheduleItem; localPath: string } =>
        Boolean(x.localPath)
      );
    const hasSfx = preparedSfx.length > 0;

    await onProgress?.(70);

    // 5. 生成字幕（ASS：时轴随变速对齐 + 逐分镜 \pos 精确定位）
    // quality 提前解析（纯函数无副作用）：ASS 的 PlayResX/Y 与 \pos 像素需画面宽高。
    // 最终画幅按「质量档位 + 项目画幅」派生（含 bitrate），下游 scale/pad/字幕定位
    // 全部读 quality.width/height/bitrate，故只需在此改绑定，其余消费点自动对齐。
    const quality = resolveOutputDimensions(
      options.quality,
      options.aspectRatio
    );
    // AI 生成提示标识（合规，广电总局令第 16 号第三十四条）：缺省即启用
    // （resolveAiDisclosure 的缺省契约），故存量项目导出也会带标识。
    const resolvedDisclosure = resolveAiDisclosure(options.aiDisclosure);

    // ASS 文件的产出条件：对白字幕开启 **或** AI 标识启用。
    // 标识是法定要求，不能因用户关字幕而消失——故二者任一为真都要生成 ASS，
    // 由 generateSubtitleFile 内部按 includeDialogueSubtitles 决定是否发对白事件。
    const needSubtitleFile =
      options.includeSubtitles || resolvedDisclosure.enabled;
    let subtitlePath: string | null = null;
    if (needSubtitleFile) {
      subtitlePath = await generateSubtitleFile(
        scenes,
        effDurations,
        tmpDir,
        quality.width,
        quality.height,
        options.subtitleStyle,
        options.subtitlePositions,
        voiceDurations,
        options.emphasisSceneIds,
        options.includeSubtitles,
        resolvedDisclosure
      );
    }

    await onProgress?.(80);

    // 6. 下载水印 logo（如果启用）
    let logoPath: string | null = null;
    if (options.watermark?.enabled && options.watermark.imageUrl) {
      try {
        logoPath = await downloadFile(
          options.watermark.imageUrl,
          `watermark_logo.png`,
          tmpDir
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
      // [0:v] → scale+pad → 可选 LUT 调色 → 可选字幕 → [base]
      // LUT 在字幕之前：只染画面，字幕/水印/贴图（后续 overlay）不受染色影响。
      let videoChain = `[0:v]scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2:black`;
      const lutFilterWm = buildColorGradeFilter(options.colorGrade);
      if (lutFilterWm) {
        videoChain += `,${lutFilterWm}`;
      }
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

      // ── SFX 音效输入（排在 overlay 图片之后，作为第三音频层）───────────
      const sfxLabelsWm: string[] = [];
      if (hasSfx) {
        const sfxStartIdx = nextInputIndex;
        for (const { localPath } of preparedSfx) {
          ffmpegArgs.push("-i", localPath);
          nextInputIndex += 1;
        }
        const sfxBuilt = buildSfxFilters(
          preparedSfx.map((x) => x.item),
          sfxStartIdx
        );
        filterParts.push(...sfxBuilt.filters);
        sfxLabelsWm.push(...sfxBuilt.labels);
      }

      // ── 音频链（与视频链用 ; 分隔，共同放入同一 filter_complex）──────
      // 音频 adelay 的索引从 1 开始（音频输入在 merged 之后），不受 logo 影响。
      // 对白 adelay + SFX volume/adelay 先入 filterParts，再由 buildFinalAudioChain
      // 统一收口「对白 + BGM + SFX」三层混音 + loudnorm（-16 LUFS）。
      const voiceLabels = audioFilters.map((_, i) => `[a${i}]`);
      filterParts.push(...audioFilters);
      const audioChain = buildFinalAudioChain({
        voiceLabels,
        bgm: hasBgm ? bgm! : null,
        bgmInputIndex,
        bgmTotalDuration,
        sfxLabels: sfxLabelsWm,
      });
      const audioOutLabel = audioChain?.outLabel ?? null;
      if (audioChain) filterParts.push(...audioChain.filters);

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
      // SFX 音效输入（第三音频层），排在 BGM 之后
      const sfxLabelsNoWm: string[] = [];
      const sfxFilterPartsNoWm: string[] = [];
      if (hasSfx) {
        const sfxStartIdx = 1 + audioCountNoWm + (bgmIdxNoWm >= 0 ? 1 : 0);
        for (const { localPath } of preparedSfx) {
          ffmpegArgs.push("-i", localPath);
        }
        const sfxBuilt = buildSfxFilters(
          preparedSfx.map((x) => x.item),
          sfxStartIdx
        );
        sfxFilterPartsNoWm.push(...sfxBuilt.filters);
        sfxLabelsNoWm.push(...sfxBuilt.labels);
      }

      // 构建视频滤镜（-vf 路径）：scale+pad → 可选 LUT 调色 → 可选字幕
      // LUT 在字幕之前：只染画面，字幕不受染色影响（与有水印路径同构）。
      let videoFilter = `scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2:black`;

      const lutFilterNoWm = buildColorGradeFilter(options.colorGrade);
      if (lutFilterNoWm) {
        videoFilter += `,${lutFilterNoWm}`;
      }

      // 添加字幕（带可选样式）
      if (subtitlePath) {
        videoFilter += `,${buildSubtitleFilter(subtitlePath)}`;
      }

      ffmpegArgs.push("-vf", videoFilter);

      // 音频混合（单独的 filter_complex，与 -vf 共存）：
      // 对白 adelay + SFX volume/adelay 先入，再由 buildFinalAudioChain 统一收口
      // 「对白 + BGM + SFX」三层混音 + loudnorm（-16 LUFS），与有水印路径同构。
      const voiceLabelsNoWm = audioFilters.map((_, i) => `[a${i}]`);
      const audioChainNoWm = buildFinalAudioChain({
        voiceLabels: voiceLabelsNoWm,
        bgm: hasBgm && bgmIdxNoWm >= 0 ? bgm! : null,
        bgmInputIndex: bgmIdxNoWm,
        bgmTotalDuration,
        sfxLabels: sfxLabelsNoWm,
      });
      if (audioChainNoWm) {
        const audioParts = [
          ...audioFilters,
          ...sfxFilterPartsNoWm,
          ...audioChainNoWm.filters,
        ];
        ffmpegArgs.push(
          "-filter_complex",
          audioParts.join(";"),
          "-map",
          "0:v",
          "-map",
          audioChainNoWm.outLabel
        );
        if (hasBgm && bgmIdxNoWm >= 0) {
          // BGM loop=longest 时用总时长兜底截断，防拖尾
          ffmpegArgs.push("-t", bgmTotalDuration.toFixed(3));
        }
      }

      // 输出设置（按 format 选编码器，webm≠mp4）
      ffmpegArgs.push(
        ...buildOutputEncodingArgs(options.format, quality.bitrate, outputPath)
      );

      await runFFmpeg(ffmpegArgs);
    }

    await onProgress?.(95);

    // 8. 把产物路径交给调用方消费（清理前）
    const result = await consume(outputPath);

    await onProgress?.(100);

    return result;
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
