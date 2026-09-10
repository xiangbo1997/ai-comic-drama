"use client";

import { SUBTITLE_FONT_BASE_HEIGHT } from "@/types/export-style";
import {
  disclosureAnchor,
  DISCLOSURE_MARGIN_RATIO,
  type ResolvedAiDisclosure,
} from "@/lib/ai-disclosure";

/**
 * AI 生成内容提示标识的预览覆盖层（合规）。
 *
 * 法规依据：《微短剧管理办法》（广电总局令第 16 号，2026-09-01 施行）第三十四条
 * 「使用人工智能技术生成、制作的微短剧……应当在每集明显位置添加提示标识」。
 *
 * 与导出端（ass/builder.ts 的 AiDisclosure 样式 + buildDisclosureEvents）**同源**：
 * 文案 / 位置 / 字号倍率 / 不透明度 / 边距比例全部读 lib/ai-disclosure 的同一份
 * 常量与 disclosureAnchor 几何契约，任一端改数值都只动 lib（预览=成片铁律）。
 *
 * z-10 契约：与卡片文字层 / 水印层同级，高于媒体层——法定标识不被画面盖住。
 * 显示时间窗由上层（preview-player）用 isDisclosureVisibleAt 判定后决定是否挂载。
 */
export function DisclosureOverlay({
  disclosure,
  subtitleFontPx,
  stageHeight,
  stageWidth,
}: {
  /** 已解析的标识配置（resolveAiDisclosure 产出，与导出端同一份） */
  disclosure: ResolvedAiDisclosure;
  /** 当前画面框下的正文字幕字号（px）——标识字号 = 它 × fontScale */
  subtitleFontPx: number;
  /** 画面框像素高（描边宽等比缩放用） */
  stageHeight: number;
  /** 画面框像素宽（边距按它换算，与导出端「边距 = 画面宽 × 比例」同源） */
  stageWidth: number;
}) {
  const { hAlign, vAlign } = disclosureAnchor(disclosure.position);
  // 边距：横向纵向同为「画面宽 × DISCLOSURE_MARGIN_RATIO」的像素量，
  // 与导出端 disclosureAssPos 的 margin 完全同式（视觉等距，预览=成片）。
  // stageWidth 未测得（首帧 rect 为 0）时回落百分比，避免标识贴死边缘。
  const marginPx =
    stageWidth > 0
      ? `${Math.round(stageWidth * DISCLOSURE_MARGIN_RATIO)}px`
      : `${DISCLOSURE_MARGIN_RATIO * 100}%`;
  // 描边宽随画面高等比缩放（同字幕/卡片文字，保证深浅底可读）
  const strokePx =
    (1.5 * (stageHeight > 0 ? stageHeight : SUBTITLE_FONT_BASE_HEIGHT)) /
    SUBTITLE_FONT_BASE_HEIGHT;

  // 横向定位：贴左/贴右用 left/right，居中用 left:50% + translateX(-50%)
  const horizontal =
    hAlign === "center"
      ? { left: "50%", transform: "translateX(-50%)" }
      : hAlign === "left"
        ? { left: marginPx }
        : { right: marginPx };
  // 纵向定位：top/bottom 用同一像素边距（与导出端等距语义一致）
  const vertical = vAlign === "top" ? { top: marginPx } : { bottom: marginPx };

  return (
    <div
      className="pointer-events-none absolute z-10 whitespace-nowrap"
      style={{
        ...horizontal,
        ...vertical,
        fontSize: `${Math.max(1, Math.round(subtitleFontPx * disclosure.fontScale))}px`,
        color: "#FFFFFF",
        opacity: disclosure.opacity,
        lineHeight: 1.2,
        WebkitTextStroke: `${strokePx}px rgba(0,0,0,0.85)`,
        textShadow: "rgba(0,0,0,0.55) 0 1px 4px",
      }}
    >
      {disclosure.text}
    </div>
  );
}
