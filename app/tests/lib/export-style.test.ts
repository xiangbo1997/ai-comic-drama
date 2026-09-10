import { describe, it, expect } from "vitest";
import {
  presetPositionToXY,
  resolveDefaultXY,
  resolveSubtitleXY,
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
} from "@/types/export-style";
import { VERTICAL_SAFE, VERTICAL_SAFE_LEFT } from "@/lib/safe-area";

/** 构造一个合法的 SubtitleStyle（便于逐字段覆盖） */
function makeStyle(patch: Partial<SubtitleStyle> = {}): SubtitleStyle {
  return { ...DEFAULT_SUBTITLE_STYLE, ...patch };
}

describe("presetPositionToXY（三档位置 → 归一化中心点，回归守卫）", () => {
  it("top/middle/bottom 映射固定坐标，横向恒 0.5", () => {
    expect(presetPositionToXY("top")).toEqual({ x: 0.5, y: 0.18 });
    expect(presetPositionToXY("middle")).toEqual({ x: 0.5, y: 0.5 });
    expect(presetPositionToXY("bottom")).toEqual({ x: 0.5, y: 0.76 });
  });

  it("三档落点全部在平台 UI 安全区内（不会被抖音/快手 UI 遮挡）", () => {
    for (const p of ["top", "middle", "bottom"] as const) {
      const { y } = presetPositionToXY(p);
      expect(y).toBeGreaterThanOrEqual(VERTICAL_SAFE.top);
      expect(y).toBeLessThanOrEqual(VERTICAL_SAFE.bottom);
    }
  });
});

describe("resolveDefaultXY（全片默认位置：自由坐标优先，否则回退三档）", () => {
  it("defaultX/defaultY 均为 number 且在安全区内时原样生效", () => {
    expect(
      resolveDefaultXY(makeStyle({ defaultX: 0.22, defaultY: 0.4 }))
    ).toEqual({ x: 0.22, y: 0.4 });
  });

  it("自由坐标越界时 clamp 到平台 UI 安全区（非 0-1）", () => {
    expect(
      resolveDefaultXY(makeStyle({ defaultX: -0.5, defaultY: 2 }))
    ).toEqual({
      x: VERTICAL_SAFE_LEFT,
      y: VERTICAL_SAFE.bottom,
    });
  });

  it("存量落在遮挡区的坐标被拉回安全区（旧默认 0.88 → 0.80）", () => {
    expect(
      resolveDefaultXY(makeStyle({ defaultX: 0.5, defaultY: 0.88 }))
    ).toEqual({ x: 0.5, y: VERTICAL_SAFE.bottom });
  });

  it("仅有其一（另一个缺失）时回退 position（不采用半个坐标）", () => {
    const onlyX = resolveDefaultXY(
      makeStyle({ defaultX: 0.8, defaultY: undefined, position: "top" })
    );
    expect(onlyX).toEqual({ x: 0.5, y: 0.18 });
  });

  it("无自由坐标时按 position 回退", () => {
    expect(resolveDefaultXY(makeStyle({ position: "middle" }))).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("style 为 undefined 时回退 bottom（默认）", () => {
    expect(resolveDefaultXY(undefined)).toEqual({ x: 0.5, y: 0.76 });
  });

  it("只有 position、无 defaultX/defaultY 的老配置走三档解析", () => {
    expect(resolveDefaultXY(makeStyle({ position: "bottom" }))).toEqual(
      presetPositionToXY("bottom")
    );
  });
});

describe("resolveSubtitleXY（逐分镜覆盖优先，否则走全片默认）", () => {
  const style = makeStyle({
    defaultX: 0.78,
    defaultY: 0.76,
    position: "bottom",
  });

  it("有该分镜的覆盖时用覆盖坐标（安全区内原样生效）", () => {
    const positions = [{ sceneId: "s1", x: 0.3, y: 0.4 }];
    expect(resolveSubtitleXY("s1", style, positions)).toEqual({
      x: 0.3,
      y: 0.4,
    });
  });

  it("覆盖坐标越界时 clamp 到安全区", () => {
    const positions = [{ sceneId: "s1", x: 5, y: -1 }];
    expect(resolveSubtitleXY("s1", style, positions)).toEqual({
      x: VERTICAL_SAFE.right,
      y: VERTICAL_SAFE.top,
    });
  });

  it("无该分镜覆盖时回退全片默认（此处走自由坐标 defaultX/defaultY）", () => {
    const positions = [{ sceneId: "other", x: 0.1, y: 0.1 }];
    expect(resolveSubtitleXY("s1", style, positions)).toEqual({
      x: 0.78,
      y: 0.76,
    });
  });

  it("无 positions 时回退全片默认", () => {
    expect(resolveSubtitleXY("s1", style, undefined)).toEqual({
      x: 0.78,
      y: 0.76,
    });
  });
});
