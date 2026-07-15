/**
 * 预览端转场样式映射（纯函数）—— 与导出端 video-synthesis 的 xfade 转场语义同源。
 *
 * 为什么抽出来：preview-player.tsx 逼近 1200 行，且转场进度→CSS 样式的映射是
 * 纯函数（无组件状态），抽成独立模块便于单测 + 让 preview-player 聚焦渲染。
 *
 * 语义对齐：导出端用 FFmpeg xfade 的 18 种 transition（含 "none"），预览端用
 * CSS 近似（opacity/transform/clip-path/遮罩层）复现「视觉可辨即可」，不追求
 * 像素级等同 xfade。转场进度 t（0→1）由 preview-player 的计时器驱动。
 */

import type { CSSProperties } from "react";
import type { TransitionType } from "@/types/export-style";

/**
 * 转场分两层渲染：
 * - 上层（当前镜）：套 currentLayerStyle()——淡出 / 推走 / 裁切 / 圆形收缩。
 * - 覆盖层（全屏黑 / 白）：仅 fadeblack/fadewhite 需要，套 overlayStyle()。
 *
 * fadeblack/fadewhite 是两段式：前半程旧画面淡到纯黑/白，后半程纯黑/白淡出露新画面。
 * 普通 fade 没有中间纯色场，靠 overlayStyle 的黑/白全屏层区分二者。
 */

/** 转场覆盖层（全屏纯色）的颜色与可见性；非 fadeblack/fadewhite 返回 null（不渲染） */
export interface TransitionOverlay {
  /** 遮罩颜色（"#000000" / "#FFFFFF"） */
  color: string;
  /** 当前不透明度 0-1（两段式：前半升到 1，后半降回 0） */
  opacity: number;
}

/**
 * 计算转场覆盖层（黑场/白场）状态。
 * 仅 fadeblack/fadewhite 有覆盖层；其余类型返回 null。
 *
 * 两段式曲线（与 xfade 的 fadeblack/fadewhite 观感一致）：
 * - t ∈ [0, 0.5]：旧画面淡出的同时，纯色遮罩从 0 升到 1（画面渐入纯色）。
 * - t ∈ [0.5, 1]：纯色遮罩从 1 降回 0（纯色渐出，露出新画面）。
 *
 * @param type 转场类型
 * @param t 转场进度 0-1
 */
export function transitionOverlay(
  type: TransitionType,
  t: number
): TransitionOverlay | null {
  if (type !== "fadeblack" && type !== "fadewhite") return null;
  if (t <= 0) return null;
  const color = type === "fadeblack" ? "#000000" : "#FFFFFF";
  // 前半程升到 1，后半程降回 0（三角波，峰值在 t=0.5）
  const opacity = t <= 0.5 ? t * 2 : (1 - t) * 2;
  return { color, opacity: Math.min(1, Math.max(0, opacity)) };
}

/**
 * 计算转场中「当前镜（上层）」的 CSS 样式。
 * transitionT（0→1）按转场类型映射为透明度 / 位移 / 裁切 / 圆形收缩。
 *
 * 各类型对齐 xfade 观感：
 * - fade/dissolve：整体淡出（fadeblack/fadewhite 的画面淡出也走这里，纯色由覆盖层补）。
 * - slide*：当前镜被推走。
 * - wipe*：当前镜从某边逐渐被裁掉。
 * - circleopen：圆形从中心向外扩张揭示新画面 → 当前镜圆形裁切半径从满收到 0。
 * - circleclose：圆形从外向中心收缩 → 当前镜可见圆环从外向内收（用外扩 inset 近似）。
 * - radial：径向扫描（用扇形 conic 遮罩，退化时用圆形近似但与普通 fade 可区分）。
 * - smoothleft/smoothright：带缓动的滑动 + 淡化组合。
 *
 * @param type 转场类型
 * @param t 转场进度 0-1
 */
export function transitionCurrentLayerStyle(
  type: TransitionType,
  t: number
): CSSProperties {
  if (t <= 0) return {};
  const pct = t * 100;

  switch (type) {
    // ── fade 系：整体淡出（fadeblack/fadewhite 画面同样淡出，纯色由覆盖层承接） ──
    case "fade":
    case "dissolve":
    case "fadeblack":
    case "fadewhite":
      return { opacity: 1 - t };

    // ── slide 系：当前镜被推走 ──
    case "slideleft":
      return { transform: `translateX(-${pct}%)` };
    case "slideright":
      return { transform: `translateX(${pct}%)` };
    case "slideup":
      return { transform: `translateY(-${pct}%)` };
    case "slidedown":
      return { transform: `translateY(${pct}%)` };

    // ── wipe 系：当前镜从某边逐渐被裁掉 ──
    case "wipeleft":
      return { clipPath: `inset(0 ${pct}% 0 0)` };
    case "wiperight":
      return { clipPath: `inset(0 0 0 ${pct}%)` };
    case "wipeup":
      return { clipPath: `inset(0 0 ${pct}% 0)` };
    case "wipedown":
      return { clipPath: `inset(${pct}% 0 0 0)` };

    // ── 圆形/径向 ──
    // circleopen：新画面从中心圆形展开 → 当前镜（上层）圆形可见区从满收缩到 0。
    // 半径从 75%（覆盖整框对角）线性收到 0，露出下层新画面。
    case "circleopen": {
      const r = (1 - t) * 75;
      return { clipPath: `circle(${r}% at 50% 50%)` };
    }
    // circleclose：旧画面从外圈向中心收缩消失 → 当前镜从四周向内被裁掉，用
    // inset 四边同步内缩 + 圆角化近似圆形收口。
    case "circleclose": {
      const inset = t * 50;
      const radius = 50 - inset; // 内缩越多圆角越小，收口成点
      return {
        clipPath: `inset(${inset}% ${inset}% ${inset}% ${inset}% round ${Math.max(0, radius)}%)`,
      };
    }
    // radial：径向扫描揭示——用 conic-gradient 遮罩把当前镜按角度逐步擦除。
    // 扫过的扇区变透明（露出下层新画面），未扫到的保持不透明。
    case "radial": {
      const angle = t * 360;
      return {
        WebkitMaskImage: `conic-gradient(from 0deg at 50% 50%, transparent 0deg ${angle}deg, black ${angle}deg 360deg)`,
        maskImage: `conic-gradient(from 0deg at 50% 50%, transparent 0deg ${angle}deg, black ${angle}deg 360deg)`,
      };
    }

    // ── smooth 系：滑动 + 淡化组合（带缓动感，位移幅度略小于纯 slide） ──
    case "smoothleft":
      return { transform: `translateX(-${pct * 0.6}%)`, opacity: 1 - t };
    case "smoothright":
      return { transform: `translateX(${pct * 0.6}%)`, opacity: 1 - t };

    // "none" 及未知类型：硬切用极短淡化兜底
    default:
      return { opacity: 1 - t };
  }
}
