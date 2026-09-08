"use client";

import type { Sticker } from "@/types/export-style";
import { visibleStickers } from "./helpers";

interface StickerLayerProps {
  stickers: Sticker[] | undefined;
  sceneId: string;
  /** 当前镜内已播时刻（秒）= progress × 该镜有效时长 */
  tInScene: number;
  /** 该镜有效时长（秒），贴图 duration 缺省/越界时的镜尾 */
  effDur: number;
  /** 拖拽中的乐观锚点（仅命中该 id 的贴图生效） */
  dragSticker: { id: string; x: number; y: number } | null;
  stickerEditable: boolean;
  handleStickerDragStart: (
    e: React.PointerEvent<HTMLImageElement>,
    sticker: Sticker
  ) => void;
}

/**
 * Stickers — 当前分镜的贴图预览（与导出 overlay 位置一致）。
 * 时间窗判定与导出端 prepareStickers 同源：仅当「当前镜内播放时刻」
 * 落在贴图 [startOffset, startOffset+duration) 内才显示（duration 缺省=到
 * 镜尾）。tInScene = progress × 该镜有效时长，与画面/字幕/配音同一时钟。
 *
 * 本组件不含任何 hook：纯展示 + 事件透传，故不影响 PreviewPlayer 的 effect 顺序。
 */
export function StickerLayer({
  stickers,
  sceneId,
  tInScene,
  effDur,
  dragSticker,
  stickerEditable,
  handleStickerDragStart,
}: StickerLayerProps) {
  return (
    <>
      {visibleStickers(stickers, sceneId, tInScene, effDur).map((st) => {
        // 拖拽中该贴图优先用本地乐观锚点（跟手 + 防落库往返闪回）
        const posX = dragSticker?.id === st.id ? dragSticker.x : st.x;
        const posY = dragSticker?.id === st.id ? dragSticker.y : st.y;
        return (
          <img
            key={st.id}
            src={st.imageUrl}
            alt=""
            // 只读预览保持 pointer-events-none 原样；可编辑时开放拖拽交互
            className={`absolute z-10 ${
              stickerEditable
                ? "ring-primary/60 cursor-move hover:ring-1"
                : "pointer-events-none"
            }`}
            title={stickerEditable ? "拖拽调整贴图位置" : undefined}
            onPointerDown={
              stickerEditable
                ? // 起手坐标用当前生效锚点（乐观值优先）：落库往返未回流时
                  // 立刻二次拖拽，若从 props 旧值起手会瞬间跳回旧位
                  (e) =>
                    handleStickerDragStart(e, {
                      ...st,
                      x: posX,
                      y: posY,
                    })
                : undefined
            }
            style={{
              width: `${st.scale * 100}%`,
              left: `${posX * 100}%`,
              top: `${posY * 100}%`,
              transform: `translate(-${posX * 100}%, -${posY * 100}%)`,
            }}
          />
        );
      })}
    </>
  );
}
