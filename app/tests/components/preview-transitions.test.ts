import { describe, it, expect } from "vitest";
import {
  transitionCurrentLayerStyle,
  transitionOverlay,
} from "@/components/preview-transitions";
import type { TransitionType } from "@/types/export-style";

describe("transitionCurrentLayerStyle（转场进度→当前镜样式，与导出端 xfade 同源）", () => {
  it("t<=0 时无样式（转场未开始）", () => {
    expect(transitionCurrentLayerStyle("fade", 0)).toEqual({});
    expect(transitionCurrentLayerStyle("wipeleft", -0.1)).toEqual({});
  });

  it("fade / dissolve / fadeblack / fadewhite 均为整体淡出（opacity=1-t）", () => {
    for (const type of [
      "fade",
      "dissolve",
      "fadeblack",
      "fadewhite",
    ] as TransitionType[]) {
      expect(transitionCurrentLayerStyle(type, 0.25)).toEqual({
        opacity: 0.75,
      });
    }
  });

  it("slide 系映射为 translate 位移（方向正确）", () => {
    expect(transitionCurrentLayerStyle("slideleft", 0.5)).toEqual({
      transform: "translateX(-50%)",
    });
    expect(transitionCurrentLayerStyle("slideright", 0.5)).toEqual({
      transform: "translateX(50%)",
    });
    expect(transitionCurrentLayerStyle("slideup", 0.5)).toEqual({
      transform: "translateY(-50%)",
    });
    expect(transitionCurrentLayerStyle("slidedown", 0.5)).toEqual({
      transform: "translateY(50%)",
    });
  });

  it("wipe 系映射为 clip-path inset（各边裁切正确）", () => {
    expect(transitionCurrentLayerStyle("wipeleft", 0.5)).toEqual({
      clipPath: "inset(0 50% 0 0)",
    });
    expect(transitionCurrentLayerStyle("wiperight", 0.5)).toEqual({
      clipPath: "inset(0 0 0 50%)",
    });
    expect(transitionCurrentLayerStyle("wipeup", 0.5)).toEqual({
      clipPath: "inset(0 0 50% 0)",
    });
    expect(transitionCurrentLayerStyle("wipedown", 0.5)).toEqual({
      clipPath: "inset(50% 0 0 0)",
    });
  });

  it("circleopen：圆形半径从 75% 收到 0（露出下层新画面）", () => {
    // t=0（临界后）半径接近满，t=1 半径归 0
    expect(transitionCurrentLayerStyle("circleopen", 0.01)).toEqual({
      clipPath: `circle(${(1 - 0.01) * 75}% at 50% 50%)`,
    });
    expect(transitionCurrentLayerStyle("circleopen", 1)).toEqual({
      clipPath: "circle(0% at 50% 50%)",
    });
  });

  it("circleclose：inset 四边同步内缩 + 圆角收口", () => {
    const style = transitionCurrentLayerStyle("circleclose", 0.5);
    // t=0.5 → inset=25%，radius=25%
    expect(style.clipPath).toBe("inset(25% 25% 25% 25% round 25%)");
  });

  it("radial：conic-gradient 遮罩随角度扫描（同时设 mask 与 -webkit-mask）", () => {
    const style = transitionCurrentLayerStyle("radial", 0.5);
    expect(style.maskImage).toContain("conic-gradient");
    expect(style.maskImage).toContain("180deg"); // 0.5 * 360
    expect(style.WebkitMaskImage).toBe(style.maskImage);
  });

  it("smooth 系：滑动幅度略小（*0.6）且叠加淡化，与纯 slide 可区分", () => {
    expect(transitionCurrentLayerStyle("smoothleft", 0.5)).toEqual({
      transform: "translateX(-30%)",
      opacity: 0.5,
    });
    expect(transitionCurrentLayerStyle("smoothright", 0.5)).toEqual({
      transform: "translateX(30%)",
      opacity: 0.5,
    });
  });

  it("none 及未知类型回落淡化（硬切兜底）", () => {
    expect(transitionCurrentLayerStyle("none", 0.4)).toEqual({ opacity: 0.6 });
  });
});

describe("transitionOverlay（黑/白覆盖层，仅 fadeblack/fadewhite）", () => {
  it("非 fadeblack/fadewhite 类型返回 null（不渲染覆盖层）", () => {
    for (const type of [
      "fade",
      "dissolve",
      "slideleft",
      "circleopen",
      "radial",
      "none",
    ] as TransitionType[]) {
      expect(transitionOverlay(type, 0.5)).toBeNull();
    }
  });

  it("t<=0 时返回 null（转场未开始）", () => {
    expect(transitionOverlay("fadeblack", 0)).toBeNull();
  });

  it("fadeblack 覆盖层为黑色，两段式三角波（峰值在 t=0.5）", () => {
    expect(transitionOverlay("fadeblack", 0.25)).toEqual({
      color: "#000000",
      opacity: 0.5, // 0.25 * 2
    });
    expect(transitionOverlay("fadeblack", 0.5)).toEqual({
      color: "#000000",
      opacity: 1, // 峰值
    });
    expect(transitionOverlay("fadeblack", 0.75)).toEqual({
      color: "#000000",
      opacity: 0.5, // (1-0.75)*2
    });
  });

  it("fadewhite 覆盖层为白色", () => {
    const o = transitionOverlay("fadewhite", 0.5);
    expect(o?.color).toBe("#FFFFFF");
    expect(o?.opacity).toBe(1);
  });
});
