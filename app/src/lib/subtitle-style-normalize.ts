/**
 * 字幕样式（全片统一）的服务端白名单校验。
 *
 * 从 api/projects/[id]/route.ts 的 normalizeGenerationParams 抽出为纯函数，
 * 使字段白名单（尤其 animation 与 defaultX/defaultY）可被单测覆盖。
 *
 * 契约：逐字段重建，非法/缺失回退默认；只放行已知字段，防止任意 JSON 落库。
 */

import type { SubtitleAnimation, SubtitleStyle } from "@/types/export-style";

/** 有限数值 clamp（NaN/Infinity 回退 min），与 route 内联版语义一致 */
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** 纵向三档位置白名单 */
const POSITIONS: ReadonlyArray<SubtitleStyle["position"]> = [
  "top",
  "middle",
  "bottom",
];

/** 入场动效白名单（与 SubtitleAnimation 联合类型一致） */
const ANIMATIONS: ReadonlyArray<SubtitleAnimation> = [
  "none",
  "fade",
  "slideup",
  "pop",
  "typewriter",
];

/**
 * 校验并规整单个字幕样式对象。
 *
 * fontSize 采用 8-96 的「安全外壳」范围（比面板 UI 的 12-48 更宽，仅防越界脏值）。
 * animation 非法/缺失回退 "fade"（与旧行为、预览/导出端解析规则一致）。
 * defaultX/defaultY 仅在「二者都是有限数值」时输出（clamp 0-1），否则整体省略——
 * 保持可选、老 payload 不长出脏字段，位置解析自动回退 position。
 *
 * @param input 任意来源的候选对象（PATCH body 里的 subtitleStyle）
 * @returns 规整后的 SubtitleStyle；input 非对象时返回 undefined
 */
export function normalizeSubtitleStyle(
  input: unknown
): SubtitleStyle | undefined {
  if (!input || typeof input !== "object") return undefined;
  const ss = input as Record<string, unknown>;

  const out: SubtitleStyle = {
    fontSize: typeof ss.fontSize === "number" ? clamp(ss.fontSize, 8, 96) : 24,
    fontColor:
      typeof ss.fontColor === "string" && /^#[0-9a-fA-F]{6}$/.test(ss.fontColor)
        ? ss.fontColor
        : "#FFFFFF",
    outlineColor:
      typeof ss.outlineColor === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(ss.outlineColor)
        ? ss.outlineColor
        : "#000000",
    outlineWidth:
      typeof ss.outlineWidth === "number" ? clamp(ss.outlineWidth, 0, 10) : 2,
    position:
      typeof ss.position === "string" &&
      POSITIONS.includes(ss.position as SubtitleStyle["position"])
        ? (ss.position as SubtitleStyle["position"])
        : "bottom",
    bold: ss.bold === true,
    backgroundBox: ss.backgroundBox === true,
    // 入场动效：白名单校验，非法/缺失回退 fade（此前被漏掉，导致选中的动效被静默丢弃）
    animation:
      typeof ss.animation === "string" &&
      ANIMATIONS.includes(ss.animation as SubtitleAnimation)
        ? (ss.animation as SubtitleAnimation)
        : "fade",
  };

  // 自由默认位置：仅二者都是有限数值时放行（clamp 0-1），否则省略
  if (
    typeof ss.defaultX === "number" &&
    Number.isFinite(ss.defaultX) &&
    typeof ss.defaultY === "number" &&
    Number.isFinite(ss.defaultY)
  ) {
    out.defaultX = clamp(ss.defaultX, 0, 1);
    out.defaultY = clamp(ss.defaultY, 0, 1);
  }

  return out;
}
