"use client";

import type { RefObject } from "react";
import type { SubtitleStyle } from "@/types/export-style";
import {
  SUBTITLE_FONT_BASE_HEIGHT,
  EMPHASIS_STYLE,
} from "@/types/export-style";
import { resolveSubtitleFont } from "@/lib/subtitle-fonts";

interface SubtitleOverlayProps {
  sceneId: string;
  subtitleStyle: SubtitleStyle | undefined;
  /** 字幕块中心的归一化坐标（拖拽乐观值优先） */
  currentSubtitleXY: { x: number; y: number };
  /** 当前生效句索引（驱动 <p> 的 key，切句时重挂载触发入场动效） */
  activeSubtitleIndex: number;
  activeSubtitleText: string;
  /** 已按画面高缩放（金句花字已 ×fontScale）的最终字号 */
  emphasisFontPx: number;
  isEmphasisScene: boolean;
  stageHeight: number;
  subtitleAnimationCss: string | undefined;
  typewriterChars: string[] | null;
  typewriterCharDelays: number[] | null;
  isPlaying: boolean;
  subtitleEditable: boolean;
  subtitleResizable: boolean;
  dragXY: { x: number; y: number } | null;
  subtitleBoxRef: RefObject<HTMLParagraphElement | null>;
  handleSubtitleDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
  handleSubtitleWheel: (e: React.WheelEvent) => void;
  handleSubtitleResizeStart: (e: React.PointerEvent) => void;
  handleSubtitleResizeMove: (e: React.PointerEvent) => void;
  handleSubtitleResizeEnd: (e: React.PointerEvent) => void;
}

/**
 * Subtitles — 绝对定位到归一化坐标（中心点），支持逐分镜拖拽。
 * 与导出 ASS \pos(x*W,y*H) 用同一坐标系，确保预览=成片。
 *
 * 本组件不含任何 hook：纯展示 + 事件透传，故不影响 PreviewPlayer 的 effect 顺序。
 */
export function SubtitleOverlay({
  sceneId,
  subtitleStyle,
  currentSubtitleXY,
  activeSubtitleIndex,
  activeSubtitleText,
  emphasisFontPx,
  isEmphasisScene,
  stageHeight,
  subtitleAnimationCss,
  typewriterChars,
  typewriterCharDelays,
  isPlaying,
  subtitleEditable,
  subtitleResizable,
  dragXY,
  subtitleBoxRef,
  handleSubtitleDragStart,
  handleSubtitleWheel,
  handleSubtitleResizeStart,
  handleSubtitleResizeMove,
  handleSubtitleResizeEnd,
}: SubtitleOverlayProps) {
  return (
    <div
      className="absolute z-10"
      style={{
        left: `${currentSubtitleXY.x * 100}%`,
        top: `${currentSubtitleXY.y * 100}%`,
        // 以中心点定位：自身偏移 -50% 让坐标对准字幕块中心
        transform: "translate(-50%, -50%)",
        // 字幕块用 nowrap 单行不换行（见下方 <p>），故不限 maxWidth——
        // 与时间轴字幕样式面板一致。不越界由拖拽落点的 clamp 保证。
      }}
    >
      {/* 逐句入场动效：key=分镜id+句索引，切句时 <p> 重挂载触发所选动效
          （fade/slideup/pop 由 <p> 整体动画驱动；typewriter 由逐字符 span
          各自动画驱动，<p> 不加整体动画）。节奏对齐导出端 libass 标签。
          slideup 的位移动画放在 <p>（内层）而非外层 wrapper——wrapper 带
          translate(-50%,-50%)，若在其上叠加 transform 会互相冲突。 */}
      <p
        key={`${sceneId}-${activeSubtitleIndex}`}
        ref={subtitleBoxRef}
        onMouseDown={subtitleEditable ? handleSubtitleDragStart : undefined}
        onTouchStart={subtitleEditable ? handleSubtitleDragStart : undefined}
        onWheel={subtitleResizable ? handleSubtitleWheel : undefined}
        className={`inline-block rounded-lg px-4 py-2 text-center leading-snug ${
          subtitleEditable
            ? "hover:ring-primary/70 cursor-move ring-1 ring-white/20 transition-shadow hover:ring-2"
            : ""
        } ${dragXY ? "ring-primary shadow-lg ring-2" : ""}`}
        style={{
          // 字体：内置白名单解析（默认思源黑体），替换旧继承字体，
          // 与导出端 ASS Fontname 同字形（预览=成片）。
          fontFamily: resolveSubtitleFont(subtitleStyle?.fontFamily).cssFamily,
          // 字号按画面框高等比缩放（与导出 ASS Fontsize 同源），预览=成片；
          // 金句花字再 ×fontScale（emphasisFontPx）。
          fontSize: `${emphasisFontPx}px`,
          // 金句花字用强调色，正文用用户配置色。
          color: isEmphasisScene
            ? EMPHASIS_STYLE.color
            : (subtitleStyle?.fontColor ?? "#FFFFFF"),
          // 花字加粗（大字需更醒目），正文按用户配置。
          fontWeight: isEmphasisScene || subtitleStyle?.bold ? 700 : 400,
          background: subtitleStyle?.backgroundBox
            ? "rgba(0,0,0,0.7)"
            : "transparent",
          textShadow: subtitleStyle
            ? `${subtitleStyle.outlineColor} 1px 1px 0, ${subtitleStyle.outlineColor} -1px -1px 0, ${subtitleStyle.outlineColor} 1px -1px 0, ${subtitleStyle.outlineColor} -1px 1px 0`
            : "rgba(0,0,0,0.8) 0 1px 2px",
          // 描边宽度随画面高等比缩放（对齐导出端 ScaledBorderAndShadow:yes），
          // 系数 = 画面框高 / 1080 基准；字越大描边越粗，两端比例一致。
          // 金句花字描边再 ×outlineScale（大字需更粗描边保可读）。
          WebkitTextStroke:
            subtitleStyle && subtitleStyle.outlineWidth > 0
              ? `${(subtitleStyle.outlineWidth * (isEmphasisScene ? EMPHASIS_STYLE.outlineScale : 1) * (stageHeight > 0 ? stageHeight : SUBTITLE_FONT_BASE_HEIGHT)) / SUBTITLE_FONT_BASE_HEIGHT}px ${subtitleStyle.outlineColor}`
              : undefined,
          // 拖拽期间禁用文本选中，避免选中文字干扰拖动
          userSelect: subtitleEditable ? "none" : undefined,
          touchAction: subtitleEditable ? "none" : undefined,
          // 入场动效（时序读共享常量，与导出端标签对齐）；typewriter 时为
          // undefined，动画落到逐字符 span 上。
          animation: subtitleAnimationCss,
          // 单句不换行（与时间轴字幕样式面板一致）——逐句字幕本就是短句，
          // nowrap 保证一句一行，不再被宽度挤成竖排一列。
          whiteSpace: "nowrap",
          // 字号平滑过渡：拖角/滚轮/滑块改字号时 CSS 插值，消除整数 px
          // 步进的顿挫感（僵硬）。仅过渡 font-size，不影响入场动效。
          transition: "font-size 80ms ease-out",
        }}
      >
        {typewriterChars && typewriterCharDelays
          ? // 打字机：逐字符 span，各自延迟显现（80ms 硬揭示）。
            // 暂停时 animationPlayState:paused 冻结揭示进度。
            // 换行符渲染为 <br>（不占 span，与导出端 \N 分隔对齐）。
            // pointer-events 默认穿透，不影响 <p> 上的拖拽手柄。
            typewriterChars.map((ch, i) =>
              ch === "\n" || ch === "\r" ? (
                <br key={i} />
              ) : (
                <span
                  key={i}
                  style={{
                    opacity: 0,
                    animation: `subtitleCharReveal 80ms linear forwards`,
                    animationDelay: `${typewriterCharDelays[i]}s`,
                    animationPlayState: isPlaying ? "running" : "paused",
                  }}
                >
                  {ch}
                </span>
              )
            )
          : activeSubtitleText}
      </p>

      {/* 四角控点：拖角改字号（剪映式，仅提供 onSubtitleStyleChange 时显示）。
          绝对定位到 wrapper 四角（wrapper 尺寸=字幕块），pointer 事件
          move/up 就近绑在控点上（setPointerCapture 保证拖出控点也跟手）。 */}
      {subtitleResizable && (
        <>
          {[
            { pos: "-top-1 -left-1", cur: "nwse-resize" },
            { pos: "-top-1 -right-1", cur: "nesw-resize" },
            { pos: "-bottom-1 -left-1", cur: "nesw-resize" },
            { pos: "-right-1 -bottom-1", cur: "nwse-resize" },
          ].map((h) => (
            <span
              key={h.pos}
              className={`border-primary absolute z-20 h-2.5 w-2.5 rounded-sm border bg-white ${h.pos}`}
              style={{ cursor: h.cur }}
              onPointerDown={handleSubtitleResizeStart}
              onPointerMove={handleSubtitleResizeMove}
              onPointerUp={handleSubtitleResizeEnd}
              onPointerCancel={handleSubtitleResizeEnd}
            />
          ))}
        </>
      )}
    </div>
  );
}
