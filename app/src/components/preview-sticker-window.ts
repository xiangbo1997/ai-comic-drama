/**
 * 预览端贴图时间窗判定（纯函数）—— 与导出端 video-synthesis.prepareStickers 同源。
 *
 * 导出端（prepareStickers）按「全片累计起始 + 分镜内偏移/时长」给每个贴图算绝对
 * 时间窗 [start, end)，overlay 用 enable='between(t,start,end)' 只在窗口内显示：
 *   base    = 该分镜的全片起始时间
 *   start   = base + (startOffset ?? 0)
 *   end     = duration !== undefined ? min(start + duration, sceneEnd) : sceneEnd
 *            （sceneEnd = base + 分镜有效时长）
 *
 * 预览端只播放「当前镜」，坐标系原点即当前镜起点（base 抵消），故把上式减去 base
 * 化简为「分镜内相对时刻」的判定：
 *   startRel = startOffset ?? 0
 *   endRel   = duration !== undefined ? min(startRel + duration, effDur) : effDur
 *   可见 ⟺ startRel ≤ tInScene < endRel
 *
 * 与导出端边界完全一致：duration 缺省 = 持续到镜尾；显式 duration 超出镜尾则截断到
 * 镜尾（min）；区间左闭右开（含 start、不含 end）。
 */

/**
 * 判断某贴图在「当前镜内相对时刻 tInScene」是否应显示。
 *
 * @param sticker 贴图的时间窗字段（startOffset / duration 均可选，语义同导出端）
 * @param tInScene 当前镜内已播放时刻（秒）= progress × 该镜有效时长
 * @param effDur 该镜有效时长（秒）；贴图 duration 缺省或越界时以此为镜尾
 * @returns 该时刻是否处于贴图时间窗 [startRel, endRel) 内
 */
export function isStickerVisibleAt(
  sticker: { startOffset?: number; duration?: number },
  tInScene: number,
  effDur: number
): boolean {
  const startRel = sticker.startOffset ?? 0;
  const endRel =
    sticker.duration !== undefined
      ? Math.min(startRel + sticker.duration, effDur)
      : effDur;
  // 左闭右开，与导出端 between(t,start,end) 对齐（含起点、不含终点）
  return tInScene >= startRel && tInScene < endRel;
}
