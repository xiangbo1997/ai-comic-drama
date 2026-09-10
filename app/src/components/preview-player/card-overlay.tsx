"use client";

import { SUBTITLE_FONT_BASE_HEIGHT } from "@/types/export-style";
import { EMPHASIS_STYLE } from "@/types/export-style";
// 成片包装（批6）：标题字体与导出端共用同一份契约常量（预览=成片的单一真源）。
import { resolveSubtitleFont, TITLE_FONT_ID } from "@/lib/subtitle-fonts";
import type { CardSpec, CardLineRole } from "@/lib/title-cards";

// 各角色字号相对字幕默认（subtitleFontPx）的视觉占比：
//   title ×2.2、hook ×1.6、sub ×1.1、cta ×0.95（cta 用强调色）。
const CARD_ROLE: Record<
  CardLineRole,
  { scale: number; topPct: number; color: string; strong: boolean }
> = {
  title: { scale: 2.2, topPct: 45, color: "#FFFFFF", strong: true },
  hook: { scale: 1.6, topPct: 45, color: "#FFFFFF", strong: true },
  sub: { scale: 1.1, topPct: 58, color: "#FFFFFF", strong: false },
  cta: {
    scale: 0.95,
    topPct: 58,
    color: EMPHASIS_STYLE.color,
    strong: false,
  },
  // 片头信息位编号（许可证号/批准文号/节目编号）：小字标注，与导出端
  // ASS CardCredential 样式同源（CARD_STYLE.credentialScale = 0.6）。
  // 置于卡片下部，避让 title/hook 主视觉。
  credential: { scale: 0.6, topPct: 72, color: "#FFFFFF", strong: false },
};

/**
 * 片头/片尾卡文字层（批6）——DOM 覆盖层（z-10 契约，高于媒体层）。
 * 得意黑（TITLE_FONT_ID）大字居中，与导出端 ASS Title/Hook 样式同源；
 * 纵向：title/hook 约 45% 高，sub/cta 约 58% 高；淡入入场。
 */
export function CardOverlay({
  card,
  subtitleFontPx,
  stageHeight,
}: {
  card: CardSpec;
  subtitleFontPx: number;
  stageHeight: number;
}) {
  // 得意黑字体族（与导出端标题字体同源）
  const titleFamily = resolveSubtitleFont(TITLE_FONT_ID).cssFamily;
  // 描边宽度随画面高等比缩放（同字幕，保证深浅底可读）
  const strokePx =
    (3 * (stageHeight > 0 ? stageHeight : SUBTITLE_FONT_BASE_HEIGHT)) /
    SUBTITLE_FONT_BASE_HEIGHT;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {card.lines.map((line, i) => {
        const role = CARD_ROLE[line.role];
        return (
          <div
            key={`${line.role}-${i}`}
            className="absolute left-1/2 w-full -translate-x-1/2 -translate-y-1/2 px-6 text-center"
            style={{
              top: `${role.topPct}%`,
              fontFamily: titleFamily,
              fontSize: `${Math.round(subtitleFontPx * role.scale)}px`,
              fontWeight: role.strong ? 700 : 500,
              color: role.color,
              lineHeight: 1.2,
              textShadow: "rgba(0,0,0,0.55) 0 2px 8px",
              WebkitTextStroke: `${strokePx}px rgba(0,0,0,0.85)`,
              // 卡片文字淡入（与导出端卡片文字入场同语义）
              animation: "subtitleFadeIn 500ms ease-out both",
            }}
          >
            {line.text}
          </div>
        );
      })}
    </div>
  );
}
