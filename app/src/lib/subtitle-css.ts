/**
 * 字幕入场动效的「预览端 CSS」单一实现。
 *
 * 纯字符串产物（不引 React），供预览播放器 preview-player 与字幕样式面板
 * SubtitleStylePanel 两处复用，避免关键帧 / animation 简写在两端各写一份而漂移。
 *
 * 时序全部读 lib/subtitle-segments 的 SUBTITLE_ANIM 常量——导出端 ASS 标签
 * （video-synthesis.buildAssAnimTags）也读同一份常量，从而 CSS 预览与 ASS 成片
 * 节奏一一对齐（预览=成片）。
 */

import { SUBTITLE_ANIM } from "@/lib/subtitle-segments";
import type { SubtitleAnimation } from "@/types/export-style";

/**
 * 逐句字幕入场动效关键帧（注入到预览舞台内的 <style>，仅需一份）。
 *
 * - subtitleFadeIn    淡入（opacity 0→1）
 * - subtitleSlideUp   从下方短距离上滑 + 淡入。起始纵向偏移用固定 0.9em 贴合视觉，
 *                     与导出端按画面高百分比（slideUpOffsetRatio）换算的位移在观感上一致
 *                     （两端都是「字号量级的一小段上滑」）。
 * - subtitlePop       从较小尺寸（popStartScale）弹跳放大到 100%，含 1.03 轻过冲
 * - subtitleCharReveal 打字机逐字符硬揭示（opacity 0→1），供 typewriter 逐字 span 使用
 */
export const SUBTITLE_KEYFRAMES_CSS = `
@keyframes subtitleFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes subtitleSlideUp {
  from { opacity: 0; transform: translateY(0.9em) }
  to { opacity: 1; transform: translateY(0) }
}
@keyframes subtitlePop {
  from { opacity: 0; transform: scale(${SUBTITLE_ANIM.popStartScale}) }
  60% { opacity: 1; transform: scale(1.03) }
  to { opacity: 1; transform: scale(1) }
}
@keyframes subtitleCharReveal { from { opacity: 0 } to { opacity: 1 } }
`;

/**
 * 把入场动效映射为 <p> 的 CSS `animation` 简写（时序读共享常量，与导出端 libass
 * 标签对齐）。
 *
 * - none        无整体动画
 * - slideup     subtitleSlideUp（时长 slideUpMs）
 * - pop         subtitlePop（时长 popMs，配 1.03 过冲缓动）
 * - typewriter  返回 undefined——它由逐字符 span 各自的 subtitleCharReveal 驱动，
 *               <p> 本身不加整体动画
 * - fade/缺省   subtitleFadeIn（时长 fadeMs）
 */
export function getSubtitleAnimationCss(
  animation: SubtitleAnimation | undefined
): string | undefined {
  switch (animation) {
    case "none":
      return undefined;
    case "slideup":
      return `subtitleSlideUp ${SUBTITLE_ANIM.slideUpMs}ms ease-out`;
    case "pop":
      // 轻微回弹缓动，配合关键帧里的 1.03 过冲
      return `subtitlePop ${SUBTITLE_ANIM.popMs}ms cubic-bezier(0.34,1.56,0.64,1)`;
    case "typewriter":
      return undefined;
    case "fade":
    default:
      return `subtitleFadeIn ${SUBTITLE_ANIM.fadeMs}ms linear`;
  }
}
