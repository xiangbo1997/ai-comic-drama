/**
 * 冲击表现力 / Ken Burns 运镜的「共享参数」单一真源（纯常量 + 纯函数，无 Node/DOM API）。
 *
 * 供导出端（video-synthesis.ts 的 ffmpeg 滤镜）与预览端（preview-player.tsx 的 CSS
 * keyframes）双端读取同一份数值，保证「预览=成片」——任何一端的震屏幅度/闪白时长/
 * 推拉倍率若与另一端不同，用户就会看到「预览≠导出」（违反预览铁律）。
 *
 * 命名与 SUBTITLE_ANIM（lib/subtitle-segments）同模式：数值集中在此，helper 计算与
 * 两端一致的正弦位移，避免同一物理量在两处各写一份而漂移。
 */

/**
 * 震屏（shake）参数：轻/重两档 + 统一衰减窗。
 *
 * 震屏用「缩放略放大 + 裁剪窗按正弦位移」实现：先把画面放大 zoomPad（露出裁剪余量），
 * 再让裁剪窗中心按 sin 抖动，抖动幅度随时间线性衰减到 0。落在镜头前 durationSec 内，
 * 之后画面归位（无残余抖动）。
 *   - light：轻震（~3Hz，峰值 ~10px），对应一般冲突/强调；
 *   - heavy：重震（~6Hz，峰值 ~30px），对应打击爆发/重击落点。
 * zoomPad 给足位移余量：峰值位移 30px 时放大到 1.06 才不会露黑边（1080p 下 3% ≈ 32px）。
 */
export const SHAKE_PARAMS = {
  /** 衰减窗时长（秒）：震屏从满幅衰减到 0 的总时长 */
  durationSec: 0.6,
  /** 缩放放大系数（露出裁剪余量，重震需要更大余量，取 1.06 通用兜住 30px 位移） */
  zoomPad: 1.06,
  light: {
    /** 抖动频率（Hz） */
    frequencyHz: 3,
    /** 峰值振幅（px，@1080 基准高） */
    amplitudePx: 10,
  },
  heavy: {
    frequencyHz: 6,
    amplitudePx: 30,
  },
} as const;

/** 震屏档位 */
export type ShakeIntensity = "light" | "heavy";

/**
 * 闪白（flash）参数：一记短促的亮度脉冲（画面骤亮再回落）。
 * 用亮度提升（导出端 eq=brightness、预览端白色覆盖层 opacity）在 durationSec 内
 * 先冲到峰值再回落，模拟漫剧「白闪」冲击。
 */
export const FLASH_PARAMS = {
  /** 闪白总时长（秒） */
  durationSec: 0.25,
  /** 峰值叠加亮度（0-1，预览端即白色覆盖层峰值 opacity；导出端即 eq brightness 增量） */
  peakBrightness: 0.85,
} as const;

/**
 * 定格（freeze）参数：镜尾冻结最后一帧一小段。
 *
 * 关键契约：定格「在镜内」发生（占用镜尾 tailSec，冻结此前的画面），而非延长镜头
 * 时长——延长会打乱 xfade offset / 字幕 / 配音时轴的同源对齐。导出端用 tpad 克隆末帧
 * 但配合前置 trim 保持总时长不变；预览端为「视频镜自然停在末帧」的近似（见 preview-player）。
 */
export const FREEZE_PARAMS = {
  /** 镜尾定格时长（秒） */
  tailSec: 0.5,
} as const;

/**
 * Ken Burns 运镜参数：图片分镜缓慢推拉/平移，杀「-loop 1 死图」的幻灯片感。
 * 导出端用 zoompan 实现（z 递增到 maxScale、x/y 表达式平移）；预览端用 CSS transform
 * 动画同参数复现（scale 到 maxScale、translate 平移）。
 */
export const KEN_BURNS_PARAMS = {
  /** 推拉最大缩放（1.12 = 最多放大 12%，幅度克制不失真） */
  maxScale: 1.12,
  /** 平移最大位移，相对画面宽/高的比例（8% = 缓慢横移的可感位移） */
  panRatio: 0.08,
  /** zoompan 输出帧率（与片段归一化帧率一致，避免 xfade 抖动） */
  fps: 30,
} as const;

/**
 * 片段统一帧率：所有片段滤镜链末尾归一到此帧率，消除 xfade 因帧率不一致的抖动，
 * 也与 Ken Burns 的 zoompan fps 对齐。
 */
export const CLIP_FPS = 30;

/**
 * 计算某时刻 t（秒，相对镜头起点）的震屏位移量（px，@1080 基准高）。
 *
 * 公式（导出端 ffmpeg 与预览端 CSS 读同一份，逐帧数值一致）：
 *   amplitude(t) = peakAmplitude × max(0, 1 - t / durationSec)   // 线性衰减到 0
 *   offset(t)    = amplitude(t) × sin(2π × frequency × t)
 * t 超过衰减窗（durationSec）后返回 0（画面归位，无残余抖动）。
 *
 * @param t          相对镜头起点的时刻（秒）
 * @param intensity  震屏档位（light/heavy）
 * @returns 该时刻的正弦位移量（px，可正可负）
 */
export function shakeOffsetAt(t: number, intensity: ShakeIntensity): number {
  if (t < 0 || t >= SHAKE_PARAMS.durationSec) return 0;
  const cfg = SHAKE_PARAMS[intensity];
  const decay = Math.max(0, 1 - t / SHAKE_PARAMS.durationSec);
  const amplitude = cfg.amplitudePx * decay;
  return amplitude * Math.sin(2 * Math.PI * cfg.frequencyHz * t);
}

/**
 * 计算某时刻 t（秒，相对镜头起点）的闪白强度（0-1）。
 *
 * 三角脉冲：前半程线性冲到峰值 peakBrightness，后半程线性回落到 0；
 * 超出 durationSec 返回 0（无残余）。导出端用作 eq brightness 增量、
 * 预览端用作白色覆盖层 opacity，两端同源。
 *
 * @param t 相对镜头起点的时刻（秒）
 * @returns 该时刻的闪白强度（0-1）
 */
export function flashIntensityAt(t: number): number {
  if (t < 0 || t >= FLASH_PARAMS.durationSec) return 0;
  const half = FLASH_PARAMS.durationSec / 2;
  const ratio = t < half ? t / half : 1 - (t - half) / half;
  return FLASH_PARAMS.peakBrightness * Math.max(0, Math.min(1, ratio));
}
