/**
 * 冲击表现力 / Ken Burns 运镜的「预览端 CSS」单一实现（纯字符串/纯函数，不引 React）。
 *
 * 与导出端 video-synthesis 的 ffmpeg 滤镜同源：数值全部读 lib/impact-effect-params
 * 的共享常量（KEN_BURNS_PARAMS / SHAKE_PARAMS / FLASH_PARAMS），保证预览 CSS 动画
 * 与成片 ffmpeg 效果同参数（幅度/倍率/时长），落实「预览=成片」铁律。
 *
 * 设计同 lib/subtitle-css：关键帧字符串注入预览舞台内的 <style>（仅一份），
 * helper 把 motion 映射为 CSS animation 简写。
 */

import {
  KEN_BURNS_PARAMS,
  SHAKE_PARAMS,
  FLASH_PARAMS,
  FREEZE_PARAMS,
} from "@/lib/impact-effect-params";
import type { SceneMotion, SceneImpact } from "@/types/export-style";

// 震屏峰值位移（em 近似）：导出端按画面高像素抖动，预览端用 em 贴合视觉——
// 轻震约 0.6em、重震约 1.8em（与 10px/30px @1080≈字号量级的一小段位移相称）。
const SHAKE_LIGHT_EM = 0.6;
const SHAKE_HEAVY_EM = 1.8;

/**
 * 运镜 + 震屏关键帧（注入预览舞台内 <style>，仅需一份）。
 *
 * - kenBurnsZoomIn/Out  缓慢推近/拉远（scale 1→maxScale / maxScale→1）
 * - kenBurnsPanLeft/Right 固定放大 + 横向平移（translateX ±panRatio 画面宽近似）
 * - impactShakeLight/Heavy 正弦式左右+上下抖动，末尾归位（衰减用关键帧幅度递减近似）
 *
 * 平移量用百分比近似导出端 panRatio（相对画面宽），推拉倍率用共享 maxScale。
 */
export const IMPACT_KEYFRAMES_CSS = `
@keyframes kenBurnsZoomIn {
  from { transform: scale(1) }
  to { transform: scale(${KEN_BURNS_PARAMS.maxScale}) }
}
@keyframes kenBurnsZoomOut {
  from { transform: scale(${KEN_BURNS_PARAMS.maxScale}) }
  to { transform: scale(1) }
}
@keyframes kenBurnsPanLeft {
  from { transform: scale(${KEN_BURNS_PARAMS.maxScale}) translateX(${KEN_BURNS_PARAMS.panRatio * 100}%) }
  to { transform: scale(${KEN_BURNS_PARAMS.maxScale}) translateX(-${KEN_BURNS_PARAMS.panRatio * 100}%) }
}
@keyframes kenBurnsPanRight {
  from { transform: scale(${KEN_BURNS_PARAMS.maxScale}) translateX(-${KEN_BURNS_PARAMS.panRatio * 100}%) }
  to { transform: scale(${KEN_BURNS_PARAMS.maxScale}) translateX(${KEN_BURNS_PARAMS.panRatio * 100}%) }
}
@keyframes impactShakeLight {
  0% { transform: translate(0, 0) }
  15% { transform: translate(${SHAKE_LIGHT_EM}em, -${SHAKE_LIGHT_EM * 0.7}em) }
  30% { transform: translate(-${SHAKE_LIGHT_EM * 0.8}em, ${SHAKE_LIGHT_EM * 0.6}em) }
  45% { transform: translate(${SHAKE_LIGHT_EM * 0.6}em, ${SHAKE_LIGHT_EM * 0.4}em) }
  60% { transform: translate(-${SHAKE_LIGHT_EM * 0.4}em, -${SHAKE_LIGHT_EM * 0.3}em) }
  80% { transform: translate(${SHAKE_LIGHT_EM * 0.2}em, ${SHAKE_LIGHT_EM * 0.15}em) }
  100% { transform: translate(0, 0) }
}
@keyframes impactShakeHeavy {
  0% { transform: translate(0, 0) }
  12% { transform: translate(${SHAKE_HEAVY_EM}em, -${SHAKE_HEAVY_EM * 0.8}em) }
  25% { transform: translate(-${SHAKE_HEAVY_EM * 0.9}em, ${SHAKE_HEAVY_EM * 0.7}em) }
  40% { transform: translate(${SHAKE_HEAVY_EM * 0.7}em, ${SHAKE_HEAVY_EM * 0.5}em) }
  55% { transform: translate(-${SHAKE_HEAVY_EM * 0.5}em, -${SHAKE_HEAVY_EM * 0.4}em) }
  70% { transform: translate(${SHAKE_HEAVY_EM * 0.35}em, ${SHAKE_HEAVY_EM * 0.25}em) }
  85% { transform: translate(-${SHAKE_HEAVY_EM * 0.2}em, ${SHAKE_HEAVY_EM * 0.1}em) }
  100% { transform: translate(0, 0) }
}
`;

/** Ken Burns 运镜 → CSS animation 简写（时长 = 分镜有效时长秒，铺满整镜缓慢运动）。 */
export function getMotionAnimationCss(
  motion: SceneMotion | null | undefined,
  durationSec: number
): string | undefined {
  if (!motion || durationSec <= 0) return undefined;
  // forwards 保持终态（推到最近后停住），linear 匀速对齐 zoompan 的线性推进
  const dur = `${durationSec.toFixed(2)}s`;
  switch (motion) {
    case "zoomIn":
      return `kenBurnsZoomIn ${dur} linear forwards`;
    case "zoomOut":
      return `kenBurnsZoomOut ${dur} linear forwards`;
    case "panLeft":
      return `kenBurnsPanLeft ${dur} linear forwards`;
    case "panRight":
      return `kenBurnsPanRight ${dur} linear forwards`;
    default:
      return undefined;
  }
}

/**
 * 冲击「震屏」→ CSS animation 简写（时长 = SHAKE_PARAMS.durationSec，落镜头前窗）。
 * 图片轻震、视频重震（与导出端 buildClipVideoFilter 的档位选择一致）。
 * isImage 缺省按视频（重震）处理。
 */
export function getShakeAnimationCss(isImage: boolean): string {
  const name = isImage ? "impactShakeLight" : "impactShakeHeavy";
  return `${name} ${SHAKE_PARAMS.durationSec}s ease-out`;
}

/**
 * 冲击「闪白」的白色覆盖层峰值 opacity（0-1）：progress 落在闪白窗内时按三角脉冲，
 * 与导出端 flashIntensityAt / eq brightness 同源（前半升后半降）。
 *
 * @param tInScene  当前镜内已播秒数（相对镜头起点）
 * @returns 白色覆盖层 opacity（0-peakBrightness）
 */
export function flashOverlayOpacityAt(tInScene: number): number {
  const dur = FLASH_PARAMS.durationSec;
  if (tInScene < 0 || tInScene >= dur) return 0;
  const half = dur / 2;
  const ratio =
    tInScene < half ? tInScene / half : 1 - (tInScene - half) / half;
  return FLASH_PARAMS.peakBrightness * Math.max(0, Math.min(1, ratio));
}

/**
 * 冲击「定格」的镜尾定格判定：当前镜内时刻落在末段 tailSec 内即为定格中。
 *
 * 预览近似说明：图片分镜本就静止，定格天然成立；视频分镜预览端难以精确冻结末帧，
 * 这里返回布尔供上层决定是否暂停视频画面（近似）——与导出端「镜内定格不延长时长」
 * 的语义一致（净时长不变，仅镜尾静止）。分镜过短（≤tailSec×2）不定格（同导出端）。
 *
 * @param tInScene    当前镜内已播秒数
 * @param durationSec 分镜有效时长（秒）
 * @returns 是否处于镜尾定格段
 */
export function isFreezeTailAt(tInScene: number, durationSec: number): boolean {
  const tail = FREEZE_PARAMS.tailSec;
  if (durationSec <= tail * 2) return false;
  return tInScene >= durationSec - tail;
}

/** 冲击类型是否为「震屏」（供上层决定是否套 shake 动画）。 */
export function isShakeImpact(impact: SceneImpact | null | undefined): boolean {
  return impact === "shake";
}
