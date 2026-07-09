/**
 * 字幕「剪映式拖角改字号」的纯几何函数。
 *
 * 时间轴字幕样式面板与主预览播放器两处共用同一实现，保证拖角手感一致。
 * 纯函数、无 DOM/React 依赖，便于单测。
 */

/**
 * 按「指针到字幕中心的像素距离」等比缩放字号：距中心越远字号越大
 * （拖角外扩=放大）。结果 clamp 到给定 UI 范围。
 *
 * @param startFont 按下时的字号
 * @param startDist 按下时指针到中心的像素距离
 * @param curDist   当前指针到中心的像素距离
 * @param min       字号下限
 * @param max       字号上限
 * @returns 取整并钳制后的新字号
 */
export function resizeFontFromDistance(
  startFont: number,
  startDist: number,
  curDist: number,
  min: number,
  max: number
): number {
  const ratio = curDist / Math.max(startDist, 1);
  const next = Math.round(startFont * ratio);
  return Math.min(max, Math.max(min, next));
}
