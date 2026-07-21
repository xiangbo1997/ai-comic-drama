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
// 音效库（解析标签 → 实际音频文件 + 默认音量），与前端/解析层共用单一真源。
import { getSfxById } from "@/lib/sfx-library";
// 混合出片成本路由：图片分镜默认运镜先按导演 cameraMovement 派生（双端同构单一真源）。
import { resolveDefaultMotion } from "@/lib/render-mode";
// 字体白名单（批6）：字幕/花字/卡片字体两端单一真源，摆脱 Arial 硬编码。
import { resolveSubtitleFont, TITLE_FONT_ID } from "@/lib/subtitle-fonts";
// 全片 LUT 调色（批6）：id → .cube 预设白名单，导出端 lut3d 统一色调。
import { resolveLutPreset, type ColorGrade } from "@/lib/color-grade";
// 片头/片尾卡（批6）：卡片文字行角色 → 卡片字幕样式映射；
// CARD_STYLE 为卡片/封面共用的字号倍率与配色单一真源。
import { CARD_STYLE, type CardLine } from "@/lib/title-cards";
// 冲击表现力 / Ken Burns 运镜的共享参数（导出端与预览端读同一份，保证预览=成片）。
import {
  SHAKE_PARAMS,
  FLASH_PARAMS,
  FREEZE_PARAMS,
  KEN_BURNS_PARAMS,
  CLIP_FPS,
} from "@/lib/impact-effect-params";
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
  SceneMotion,
  SceneImpact,
  BackgroundMusic,
  SceneSfx,
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
 * 构建图片分镜的 Ken Burns 运镜 zoompan 表达式（缓慢推拉/平移，杀「-loop 1 死图」）。
 *
 * 输入图片先放大（scale 到画面 2 倍）供 zoompan 采样，再按 motion 生成 z/x/y 表达式，
 * 最后输出回画面尺寸。d = 时长 × fps，fps 与 CLIP_FPS 对齐。
 *   - zoomIn   z 从 1 线性增到 maxScale（缓慢推近），画面居中
 *   - zoomOut  z 从 maxScale 线性回到 1（缓慢拉远），画面居中
 *   - panLeft  z 固定 maxScale，x 从右向左移（画面向左扫）
 *   - panRight z 固定 maxScale，x 从左向右移
 *
 * @param width         成片画面宽
 * @param height        成片画面高
 * @param motion        运镜类型
 * @param durationSec   分镜时长（秒），决定 d 帧数
 * @returns zoompan 滤镜片段（含前置 scale 上采样与后置 scale 归位）
 */
function buildKenBurnsFilter(
  width: number,
  height: number,
  motion: SceneMotion,
  durationSec: number
): string {
  const fps = KEN_BURNS_PARAMS.fps;
  const maxScale = KEN_BURNS_PARAMS.maxScale;
  // 帧数（至少 1 帧，防 d=0）
  const d = Math.max(1, Math.round(durationSec * fps));
  // 上采样倍数：留足 zoompan 采样与平移余量（放大 2 倍避免边缘露黑）
  const upW = width * 2;
  const upH = height * 2;
  // 归一化进度 on/(d-1)（on 为 zoompan 当前帧序号），d=1 时退化为 0 防除零
  const denom = d > 1 ? d - 1 : 1;
  const progress = `(on/${denom})`;

  // z 表达式（推拉）与 x/y 表达式（平移/居中）
  let zExpr: string;
  let xExpr: string;
  let yExpr: string;
  // 居中：把放大后的采样窗对齐画面中心
  const centerX = `(iw-iw/zoom)/2`;
  const centerY = `(ih-ih/zoom)/2`;
  switch (motion) {
    case "zoomOut":
      zExpr = `${maxScale}-(${maxScale}-1)*${progress}`;
      xExpr = centerX;
      yExpr = centerY;
      break;
    case "panLeft":
      // z 固定放大；x 从最大偏移线性回到 0（采样窗自右向左 → 画面向左扫）
      zExpr = `${maxScale}`;
      xExpr = `(iw-iw/zoom)*(1-${progress})`;
      yExpr = centerY;
      break;
    case "panRight":
      zExpr = `${maxScale}`;
      xExpr = `(iw-iw/zoom)*${progress}`;
      yExpr = centerY;
      break;
    case "zoomIn":
    default:
      zExpr = `1+(${maxScale}-1)*${progress}`;
      xExpr = centerX;
      yExpr = centerY;
      break;
  }
  // 前置放大 → zoompan（按帧推进）→ 归位到画面尺寸，末尾 fps 归一
  return (
    `scale=${upW}:${upH},` +
    `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${d}:s=${width}x${height}:fps=${fps}`
  );
}

/**
 * 构建冲击「震屏」滤镜片段：放大 + 裁剪窗按共享正弦公式抖动（落在镜头前 durationSec）。
 *
 * 与预览端 CSS 读同一份 SHAKE_PARAMS（幅度/频率/衰减），逐帧位移用与 shakeOffsetAt
 * 相同的正弦×线性衰减公式表达（ffmpeg 用 t 时间变量）。窗外（t≥durationSec）位移
 * 表达式自然归 0（衰减因子 max(0,1-t/dur) 为 0），画面归位。
 *
 * @param width      画面宽
 * @param height     画面高
 * @param intensity  档位（light/heavy）
 * @returns scale + crop 抖动滤镜片段
 */
function buildShakeFilter(
  width: number,
  height: number,
  intensity: "light" | "heavy"
): string {
  const cfg = SHAKE_PARAMS[intensity];
  const dur = SHAKE_PARAMS.durationSec;
  const pad = SHAKE_PARAMS.zoomPad;
  // 振幅按画面高相对 1080 基准缩放（参数以 @1080 定义），跨分辨率视觉一致
  const ampPx = (cfg.amplitudePx * height) / 1080;
  const upW = Math.round(width * pad);
  const upH = Math.round(height * pad);
  // 衰减因子：max(0,1-t/dur)，窗外为 0；正弦项 sin(2π f t)
  const decay = `max(0\\,1-t/${dur})`;
  const sine = `sin(2*PI*${cfg.frequencyHz}*t)`;
  const offset = `(${ampPx.toFixed(2)})*${decay}*${sine}`;
  // 裁剪窗中心 = 放大余量中点 ± 抖动位移；x/y 各自抖动（y 用 cos 相位差制造二维晃动）
  const cosine = `cos(2*PI*${cfg.frequencyHz}*t)`;
  const offsetY = `(${ampPx.toFixed(2)})*${decay}*${cosine}`;
  return (
    `scale=${upW}:${upH},` +
    `crop=${width}:${height}:'(iw-${width})/2+${offset}':'(ih-${height})/2+${offsetY}'`
  );
}

/**
 * 构建冲击「闪白」滤镜片段：镜头前 durationSec 内亮度三角脉冲（骤亮再回落）。
 *
 * 与预览端白色覆盖层读同一份 FLASH_PARAMS。用 eq=brightness 配 enable 时间窗；
 * brightness 表达式用「三角脉冲 × 峰值」，与 flashIntensityAt 同形（前半升后半降）。
 */
function buildFlashFilter(): string {
  const dur = FLASH_PARAMS.durationSec;
  const half = dur / 2;
  const peak = FLASH_PARAMS.peakBrightness;
  // 三角脉冲：t<half 时 t/half，否则 1-(t-half)/half；乘峰值亮度
  const tri = `if(lt(t\\,${half})\\,t/${half}\\,1-(t-${half})/${half})`;
  const bright = `${peak}*${tri}`;
  return `eq=brightness='${bright}':enable='between(t,0,${dur})'`;
}

/**
 * 构建冲击「定格」滤镜片段：镜尾冻结最后一帧 tailSec，且总时长不变（在镜内定格）。
 *
 * 契约（见 FREEZE_PARAMS 注释）：不延长镜头。做法 = 先 trim 掉镜尾 tailSec 的动态
 * 内容，再用 tpad 克隆末帧补回 tailSec，净时长守恒。分镜过短（≤ tailSec×2）时跳过定格
 * （返回空串，调用方不拼），避免把整镜冻死。
 *
 * @param durationSec 分镜有效时长（秒）
 * @returns trim+tpad 滤镜片段；分镜过短时返回空串
 */
function buildFreezeFilter(durationSec: number): string {
  const tail = FREEZE_PARAMS.tailSec;
  // 定格段需小于镜长，且留出至少 tail 的动态铺垫，否则整镜近乎全冻，跳过
  if (durationSec <= tail * 2) return "";
  const keep = durationSec - tail;
  // 保留前 keep 秒动态 → tpad 克隆末帧补 tail 秒 → 净时长回到 durationSec
  return `trim=0:${keep.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${tail.toFixed(3)}`;
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
 * loudnorm 目标：EBU R128 -16 LUFS / TP -1.5 dBFS / LRA 11，短剧/流媒体通行响度。
 * 单遍 loudnorm（非双遍）——导出为一次性同步管线，不便二次探测；单遍已能显著
 * 收敛「逐镜音量漂移」（此前 amix 缺 normalize=0 的老账）+ 统一全片响度。
 */
const LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11";

/**
 * 构建「最终混音链」——统一收口 对白 + BGM + SFX 三层，末尾套 loudnorm 归一化。
 *
 * 混音层级 voice > SFX > BGM > ambient：对白权重最高，SFX 次之（叠加、稍低），
 * BGM 最低（已在 buildBgmFilter 内给 0.6 权重或 ducking 压低）。三层都走 amix
 * 且 normalize=0——normalize=1（默认）会把总响度按输入数拉平，导致「分镜越多、
 * 对白越小声」的逐镜漂移（此前无水印 voice-only 路径正是漏了 normalize=0 的 bug）。
 * 最后统一 loudnorm 到 -16 LUFS，修「全片无统一响度」。
 *
 * 分支：
 *   1. 先得到「对白+BGM」的基混音标签 baseLabel：
 *      - 有 BGM：调 buildBgmFilter（含 ducking / 权重 / 无对白时 BGM 独轨）；
 *      - 无 BGM 有对白：voice amix(normalize=0)；
 *      - 无 BGM 无对白：无基轨（baseLabel=null）。
 *   2. 若有 SFX：baseLabel（如有）与所有 [sfxK] 一起 amix(normalize=0, weights
 *      对白/基轨=1、SFX=0.9)；无基轨时 SFX 自身 amix。
 *   3. 对最终标签套 loudnorm → [amaster]。全程无音频（无对白/BGM/SFX）→ 返回 null。
 *
 * @returns { filters, outLabel } 或 null（完全无音频时，调用方不 map 音频）
 */
function buildFinalAudioChain(params: {
  voiceLabels: string[];
  bgm: BackgroundMusic | null;
  bgmInputIndex: number;
  bgmTotalDuration: number;
  sfxLabels: string[];
}): { filters: string[]; outLabel: string } | null {
  const { voiceLabels, bgm, bgmInputIndex, bgmTotalDuration, sfxLabels } =
    params;
  const filters: string[] = [];

  // ── 1. 对白 + BGM 基混音 ──────────────────────────────────────────
  let baseLabel: string | null = null;
  if (bgm && bgmInputIndex >= 0) {
    const bgmBuilt = buildBgmFilter(
      bgm,
      bgmInputIndex,
      bgmTotalDuration,
      voiceLabels
    );
    filters.push(...bgmBuilt.filters);
    baseLabel = bgmBuilt.outLabel;
  } else if (voiceLabels.length > 0) {
    // 无 BGM 有对白：normalize=0 防逐镜漂移（修 voice-only 老 bug）
    filters.push(
      `${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0[voicemix]`
    );
    baseLabel = "[voicemix]";
  }

  // ── 2. 叠加 SFX 层 ────────────────────────────────────────────────
  let mixedLabel: string | null = baseLabel;
  if (sfxLabels.length > 0) {
    if (baseLabel) {
      const inputs = [baseLabel, ...sfxLabels];
      // 基轨（含对白/BGM）权重 1，SFX 各 0.9（叠加但略低于对白）
      const weights = ["1", ...sfxLabels.map(() => "0.9")].join(" ");
      filters.push(
        `${inputs.join("")}amix=inputs=${inputs.length}:normalize=0:weights='${weights}'[premaster]`
      );
      mixedLabel = "[premaster]";
    } else {
      // 纯 SFX（无对白无 BGM，极少见）：SFX 自身 amix
      if (sfxLabels.length === 1) {
        mixedLabel = sfxLabels[0];
      } else {
        filters.push(
          `${sfxLabels.join("")}amix=inputs=${sfxLabels.length}:normalize=0[premaster]`
        );
        mixedLabel = "[premaster]";
      }
    }
  }

  if (!mixedLabel) return null; // 完全无音频

  // ── 3. loudnorm 归一化到 -16 LUFS ────────────────────────────────
  filters.push(`${mixedLabel}${LOUDNORM_FILTER}[amaster]`);
  return { filters, outLabel: "[amaster]" };
}

/**
 * 单条已解析的 SFX 触发：静态资源 URL + 全片绝对触发时刻 + 音量。
 * 由 buildSfxSchedule（纯函数）从 options.sfx + 转场自动 whoosh 计算，
 * 供导出层下载 + adelay 混入，也供预览端复用同一时刻调度（预览=成片）。
 */
export interface SfxScheduleItem {
  /** 音效静态资源 URL（如 /sfx/whoosh/whoosh-fast-1492.mp3） */
  url: string;
  /** 全片时间轴上的触发时刻（秒） */
  triggerSec: number;
  /** 音量 0-1 */
  volume: number;
  /** 来源标记：显式配置 or 转场自动补的 whoosh（便于调试/去重） */
  origin: "config" | "transition";
}

/** 转场自动 whoosh 用的音效 id 与默认音量（转场处补一记疾风，掩盖切换硬感） */
const AUTO_TRANSITION_SFX_ID = "whoosh-fast";
const AUTO_TRANSITION_SFX_VOLUME = 0.5;

/**
 * 计算全片 SFX 触发时间表（纯函数，导出端与预览端共用）。
 *
 * 输入：
 *   - sfx           显式音效配置（按 sceneId + offsetSec）
 *   - sceneStarts   各分镜在成片时间轴上的起始秒（buildSceneStarts 产出）
 *   - sceneIds      与 sceneStarts index 对齐的分镜 id
 *   - transitionSfx 转场自动 whoosh 的触发点（全片绝对秒），可空
 *
 * 处理：
 *   1. 逐条显式 SFX：sfxId 解析到音效文件（未命中跳过，图形化降级），
 *      triggerSec = sceneStart[该 sceneId] + offsetSec，volume 缺省用 defaultVolume；
 *   2. 转场自动 whoosh：每个触发点补一条 whoosh-fast（origin=transition）；
 *   3. 按 triggerSec 升序稳定排序，便于导出/预览按序处理。
 *
 * 未命中的 sfxId / 未知 sceneId 一律跳过（不抛错、不阻断），保证「引用缺失 → 跳过」。
 */
export function buildSfxSchedule(
  sfx: SceneSfx[] | undefined,
  sceneStarts: number[],
  sceneIds: string[],
  transitionSfx: number[] = []
): SfxScheduleItem[] {
  const startById = new Map<string, number>();
  for (let i = 0; i < sceneIds.length; i += 1) {
    startById.set(sceneIds[i], sceneStarts[i]);
  }

  const items: SfxScheduleItem[] = [];

  for (const s of sfx ?? []) {
    const entry = getSfxById(s.sfxId);
    if (!entry) continue; // 音效 id 未命中库 → 跳过（降级）
    const base = startById.get(s.sceneId);
    if (base === undefined) continue; // 分镜 id 未知 → 跳过
    const offset = Number.isFinite(s.offsetSec) ? Math.max(0, s.offsetSec) : 0;
    const vol =
      typeof s.volume === "number" && Number.isFinite(s.volume)
        ? Math.min(1, Math.max(0, s.volume))
        : entry.defaultVolume;
    items.push({
      url: entry.file,
      triggerSec: base + offset,
      volume: vol,
      origin: "config",
    });
  }

  // 转场自动 whoosh
  const whoosh = getSfxById(AUTO_TRANSITION_SFX_ID);
  if (whoosh) {
    for (const t of transitionSfx) {
      if (!Number.isFinite(t) || t < 0) continue;
      items.push({
        url: whoosh.file,
        triggerSec: t,
        volume: AUTO_TRANSITION_SFX_VOLUME,
        origin: "transition",
      });
    }
  }

  // 按触发时刻升序（稳定）——保证导出 adelay 与预览调度顺序一致，便于调试
  return items.sort((a, b) => a.triggerSec - b.triggerSec);
}

/**
 * 构建 SFX（音效）混音滤镜片段——第三音频层，与 buildBgmFilter 同构。
 *
 * 每条已下载的音效：[输入]volume=v,adelay=ms|ms → [sfxK]，作为独立音轨。
 * 调用方把这些 [sfxK] 标签连同对白/BGM 一起并入最终 amix（normalize=0，
 * 保持音效为「叠加」而非「拉平」）。SFX 相对对白略低（volume 已按 defaultVolume/
 * 用户值定，环境类更低），符合 voice > SFX > BGM > ambient 层级。
 *
 * @param items           已解析且「已成功下载」的 SFX 列表（紧凑，逐条对应一个 ffmpeg 输入）
 * @param inputStartIndex SFX 在 ffmpeg -i 列表中的首个输入索引（items[0] 对应此索引）
 * @returns { filters: 滤镜片段[], labels: 生成的音轨标签[] }
 */
function buildSfxFilters(
  items: SfxScheduleItem[],
  inputStartIndex: number
): { filters: string[]; labels: string[] } {
  const filters: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const inputIdx = inputStartIndex + i;
    const delayMs = Math.max(0, Math.round(it.triggerSec * 1000));
    const label = `[sfx${i}]`;
    const vol = Math.min(1, Math.max(0, it.volume)).toFixed(3);
    filters.push(
      `[${inputIdx}:a]volume=${vol},adelay=${delayMs}|${delayMs}${label}`
    );
    labels.push(label);
  }
  return { filters, labels };
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

/** 卡片文字行角色 → ASS Style 名映射（片头/片尾卡，批6） */
const CARD_ROLE_TO_STYLE: Record<CardLine["role"], string> = {
  title: "CardTitle",
  sub: "CardSub",
  hook: "CardHook",
  cta: "CardCta",
};

/**
 * 构建单张卡片（片头/片尾）的 ASS 字幕事件——整卡时长内一次性显示居中偏排文字。
 *
 * 卡片分镜是普通图片分镜（底图自带 Ken Burns 缓推），文字全部走字幕层：
 *   - 每行一条 Dialogue，Style 按 role 映射（title→CardTitle 等）；
 *   - 时间窗 = 整卡时长（cardStart ~ cardStart+cardDuration）；
 *   - 位置 \an5\pos 居中偏排：title/hook 在画面高 45% 处（偏上，视觉重心），
 *     sub/cta 在 58% 处（title 之下），x 恒居中；
 *   - 入场用 \fad(300,200) 柔和淡入淡出。
 *
 * @param card         卡片描述（kind + lines）
 * @param cardStart    卡片在成片时间轴上的起始秒
 * @param cardDuration 卡片时长（秒）
 * @param width,height 成片画面宽高（\pos 像素换算）
 * @returns Dialogue 事件字符串数组（每行一条）
 */
function buildCardEvents(
  card: { kind: "title" | "end"; lines: CardLine[] },
  cardStart: number,
  cardDuration: number,
  width: number,
  height: number
): string[] {
  const events: string[] = [];
  const start = formatAssTime(cardStart);
  const end = formatAssTime(cardStart + cardDuration);
  const cx = Math.round(width * 0.5);
  // 上排（title/hook）在 45% 高，下排（sub/cta）在 58% 高——上下分层不重叠
  const topY = Math.round(height * 0.45);
  const bottomY = Math.round(height * 0.58);

  for (const line of card.lines) {
    const styleName = CARD_ROLE_TO_STYLE[line.role];
    const py = line.role === "title" || line.role === "hook" ? topY : bottomY;
    // \an5 中心锚点 + \pos 居中偏排 + \fad 柔和进出；文本转义防注入
    const text = `{\\an5\\pos(${cx},${py})\\fad(300,200)}${escapeAssText(line.text)}`;
    events.push(`Dialogue: 0,${start},${end},${styleName},,0,0,0,,${text}`);
  }
  return events;
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
  emphasisSceneIds?: string[]
): Promise<string> {
  const events: string[] = [];
  let currentTime = 0;
  // 金句花字分镜集合（O(1) 命中判断）
  const emphasisSet = new Set(emphasisSceneIds ?? []);

  for (let i = 0; i < scenes.length; i += 1) {
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

  const assContent =
    buildAssHeader(width, height, subtitleStyle) + events.join("\n") + "\n";
  const assPath = path.join(outputPath, "subtitles.ass");
  await writeFile(assPath, assContent, "utf-8");
  return assPath;
}

/**
 * 构建 ASS 文件头（[Script Info] + [V4+ Styles] + [Events] 表头）。
 * 样式从 SubtitleStyle 映射；位置不在此声明（逐事件用 \pos 控制）。
 *
 * 批6 成片包装：
 * - Default 的 Fontname 由 Arial 硬编码改为 resolveSubtitleFont(style.fontFamily)
 *   的 assFontName（配合 buildSubtitleFilter 的 fontsdir 钉到仓库 fonts/ 目录，
 *   中文字形两端可控）。
 * - 追加 Emphasis（金句花字）与 CardTitle/CardSub/CardHook/CardCta（片头尾卡）
 *   五个专用样式，字号全部经 resolveSubtitleFontPx 基准换算，不硬编码绝对像素。
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
  // 正文/字幕字体：白名单解析（替换旧 Arial 硬编码，中文字形两端可控）
  const bodyFont = resolveSubtitleFont(style?.fontFamily).assFontName;
  // 标题/花字/卡片字体：得意黑（显示型斜体，冲击力强）
  const titleFont = resolveSubtitleFont(TITLE_FONT_ID).assFontName;

  // ── 金句花字 Emphasis：正文字号 × fontScale、暖金主色、更粗描边、粗体 ──
  const emphasisSize = Math.max(
    1,
    Math.round(fontSize * EMPHASIS_STYLE.fontScale)
  );
  const emphasisColor = hexToAssColor(EMPHASIS_STYLE.color);
  const emphasisOutline = Math.max(
    1,
    Math.round(s.outlineWidth * EMPHASIS_STYLE.outlineScale)
  );

  // ── 片头/片尾卡样式组：字号全部以 fontSize 为基准按倍率派生（勿硬编码像素）──
  // CardTitle 剧名大字，CardSub 集数，CardHook 钩子悬念，CardCta 追更贴字。
  // 字号倍率 / 配色 / 描边倍率读 CARD_STYLE 单一真源（与平台封面共用）。
  const cardTitleSize = resolveSubtitleFontPx(
    s.fontSize * CARD_STYLE.titleScale,
    height
  );
  const cardSubSize = resolveSubtitleFontPx(
    s.fontSize * CARD_STYLE.subScale,
    height
  );
  const cardHookSize = resolveSubtitleFontPx(
    s.fontSize * CARD_STYLE.hookScale,
    height
  );
  const cardCtaSize = resolveSubtitleFontPx(
    s.fontSize * CARD_STYLE.ctaScale,
    height
  );
  const whiteColor = hexToAssColor(CARD_STYLE.fillColor);
  const blackOutline = hexToAssColor(CARD_STYLE.outlineColor);
  const cardCtaColor = hexToAssColor(CARD_STYLE.ctaColor);
  // 卡片描边加粗保证大字在任意底图上可读（正文描边宽 × outlineScale，最小 2）
  const cardOutline = Math.max(
    2,
    Math.round(s.outlineWidth * CARD_STYLE.outlineScale)
  );

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
    `Style: Default,${bodyFont},${fontSize},${primary},&H000000FF,${outline},${backColour},${bold},0,0,0,100,100,0,0,${borderStyle},${s.outlineWidth},0,5,20,20,20,1`,
    // 金句花字：大字号 + 暖金 + 粗描边 + 粗体，BorderStyle 恒 1（描边，不套底框）
    `Style: Emphasis,${bodyFont},${emphasisSize},${emphasisColor},&H000000FF,${blackOutline},${backColour},-1,0,0,0,100,100,0,0,1,${emphasisOutline},0,5,20,20,20,1`,
    // 卡片标题：得意黑巨字，白字粗描边
    `Style: CardTitle,${titleFont},${cardTitleSize},${whiteColor},&H000000FF,${blackOutline},${backColour},-1,0,0,0,100,100,0,0,1,${cardOutline},0,5,20,20,20,1`,
    // 卡片副标题（集数）
    `Style: CardSub,${titleFont},${cardSubSize},${whiteColor},&H000000FF,${blackOutline},${backColour},0,0,0,0,100,100,0,0,1,${cardOutline},0,5,20,20,20,1`,
    // 卡片钩子悬念
    `Style: CardHook,${titleFont},${cardHookSize},${whiteColor},&H000000FF,${blackOutline},${backColour},-1,0,0,0,100,100,0,0,1,${cardOutline},0,5,20,20,20,1`,
    // 卡片追更贴字（暖金强调色，读 CARD_STYLE.ctaColor 单一真源）
    `Style: CardCta,${titleFont},${cardCtaSize},${cardCtaColor},&H000000FF,${blackOutline},${backColour},0,0,0,0,100,100,0,0,1,${cardOutline},0,5,20,20,20,1`,
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
 *
 * 批6：追加 fontsdir 钉到仓库 fonts/ 目录（内置思源黑体 OTF / 得意黑 TTF 所在），
 * 让 libass 从仓库自带字体加载，摆脱对系统字体的依赖（此前 Arial 硬编码时代
 * 服务器无中文字体则字幕方框乱码）。转义方式与 assPath 完全一致。
 */
function buildSubtitleFilter(subtitlePath: string): string {
  // 转义路径中的特殊字符（FFmpeg filter 语法要求）
  const escapePath = (p: string): string =>
    p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

  const escapedPath = escapePath(subtitlePath);
  // 内置字体目录（绝对路径）：仓库 fonts/ 下的全字集 OTF/TTF
  const fontsDir = escapePath(path.join(process.cwd(), "fonts"));

  // ASS 文件用 ass filter（样式与逐条 \pos 定位全部内嵌在文件中，无需 force_style）；
  // fontsdir 指定字体加载目录，与 ASS Style 的 Fontname（assFontName）配套。
  return `ass='${escapedPath}':fontsdir='${fontsDir}'`;
}

/**
 * 构建全片 LUT 调色滤镜片段（批6）：`lut3d='<.cube 绝对路径>'`。
 *
 * 治「跨 provider 每镜色温各异的素材拼接感」：终混时在 scale+pad 之后、字幕之前
 * 统一染色（字幕/水印/贴图不受影响，因它们在染色之后叠加）。
 *
 * 优雅降级（不阻塞导出）：
 *   - colorGrade 未启用 / 缺省 → 返回 null（不插滤镜）；
 *   - lutId 白名单外（resolveLutPreset 返回 null）→ 返回 null；
 *   - .cube 文件不存在（existsSync 失败）→ log.warn 后返回 null。
 * 返回 null 时调用方不拼 lut3d，成片仍正常导出（只是无统一调色）。
 *
 * @returns lut3d 滤镜片段（如 `lut3d='/abs/vivid-anime.cube'`）或 null
 */
function buildColorGradeFilter(colorGrade?: ColorGrade): string | null {
  if (!colorGrade?.enabled) return null;
  const preset = resolveLutPreset(colorGrade.lutId);
  if (!preset) return null;
  // .cube 相对 app 运行目录（public/luts/x.cube）→ 拼绝对路径
  const cubeAbsPath = path.join(process.cwd(), preset.cubeFile);
  if (!existsSync(cubeAbsPath)) {
    log.warn(`LUT .cube 文件不存在，跳过调色: ${cubeAbsPath}`);
    return null;
  }
  // 转义方式与字幕路径一致（FFmpeg filter 语法要求）
  const escaped = cubeAbsPath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
  return `lut3d='${escaped}'`;
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

/** 单片段滤镜链的运镜/冲击参数（Ken Burns 仅图片分镜生效，冲击两者通用） */
interface ClipMotionImpactParams {
  /** 是否图片分镜（决定是否走 Ken Burns zoompan） */
  isImage: boolean;
  /** Ken Burns 运镜；null=不加运镜（图片分镜由调用方兜底默认 zoomIn） */
  motion: SceneMotion | null;
  /** 单镜冲击重音；null=无冲击 */
  impact: SceneImpact | null;
  /** 分镜有效时长（秒）：Ken Burns 帧数与 freeze 定格判定用 */
  durationSec: number;
}

/**
 * 构建片段视频滤镜链：
 *   (图片分镜且有运镜 ? Ken Burns zoompan : scale+pad 统一画幅)
 *   → 可选 FX 滤镜 → 可选冲击（shake/flash/freeze）→ 可选变速 → fps 归一(30)。
 *
 * 帧率归一（fps=30）恒挂链尾：让所有片段帧率一致，消除 xfade 因帧率不齐的抖动，
 * 也与 Ken Burns 的 zoompan fps 对齐。变速用 setpts=PTS/speed 改变视频流时长。
 *
 * Ken Burns 内部已含 scale+zoompan 输出到目标尺寸（不再叠加 scale+pad）；
 * 无运镜（视频分镜 / 图片显式关运镜）走原 scale+pad 统一画幅路径。
 */
function buildClipVideoFilter(
  width: number,
  height: number,
  effect: string | null,
  speed: number,
  motionImpact?: ClipMotionImpactParams
): string {
  const useKenBurns =
    !!motionImpact?.isImage &&
    motionImpact.motion !== null &&
    !!motionImpact.motion;

  const parts: string[] = [];
  if (useKenBurns && motionImpact) {
    // Ken Burns 自带 scale 上采样 + zoompan 输出到 width×height（已统一画幅）
    parts.push(
      buildKenBurnsFilter(
        width,
        height,
        motionImpact.motion as SceneMotion,
        motionImpact.durationSec
      )
    );
  } else {
    parts.push(
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
    );
  }

  if (effect) parts.push(effect);

  // 冲击重音（在滤镜之后、变速之前）：shake/flash 落镜头前窗；freeze 在镜尾定格
  const impact = motionImpact?.impact ?? null;
  if (impact === "shake") {
    // 图片轻震、视频重震：图片是静止画，轻震即够；视频动态画配重震更有力
    const intensity = motionImpact?.isImage ? "light" : "heavy";
    parts.push(buildShakeFilter(width, height, intensity));
  } else if (impact === "flash") {
    parts.push(buildFlashFilter());
  } else if (impact === "freeze") {
    const freeze = buildFreezeFilter(motionImpact?.durationSec ?? 0);
    if (freeze) parts.push(freeze);
  }

  if (speed !== 1) parts.push(`setpts=PTS/${speed.toFixed(4)}`);
  // 帧率归一恒挂链尾（Ken Burns 已在 zoompan 里设 fps，这里再显式统一无副作用）
  parts.push(`fps=${CLIP_FPS}`);
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

    onProgress?.(60);

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
            `audio_${scene.order}.mp3`
          );
          audioInputs.push("-i", audioPath);
          audioFilters.push(
            `[${audioIndex + 1}:a]adelay=${Math.round(currentTime * 1000)}|${Math.round(currentTime * 1000)}[a${audioIndex}]`
          );
          audioIndex++;
          // 探测配音真实时长供字幕对齐（探测失败留 undefined，字幕回退按镜时长分配）
          try {
            const probed = await getMediaDuration(audioPath);
            if (probed > 0) voiceDurations[i] = probed;
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
        bgmPath = await downloadFile(absolutizeUrl(bgm.url), "bgm_track.mp3");
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
          `sfx_${i}.mp3`
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
        options.subtitlePositions,
        voiceDurations,
        options.emphasisSceneIds
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
