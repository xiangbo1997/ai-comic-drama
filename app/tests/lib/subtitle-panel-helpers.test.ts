import { describe, it, expect } from "vitest";
import {
  nearestBand,
  resizeFontFromDistance,
} from "@/app/(dashboard)/editor/[id]/components/SubtitleStylePanel";

describe("nearestBand（归一化 y → 三档纵向）", () => {
  it("上三分之一 → top", () => {
    expect(nearestBand(0)).toBe("top");
    expect(nearestBand(0.12)).toBe("top");
    expect(nearestBand(0.32)).toBe("top");
  });
  it("中三分之一 → middle", () => {
    expect(nearestBand(0.33)).toBe("middle");
    expect(nearestBand(0.5)).toBe("middle");
    expect(nearestBand(0.65)).toBe("middle");
  });
  it("下三分之一 → bottom", () => {
    expect(nearestBand(0.66)).toBe("bottom");
    expect(nearestBand(0.88)).toBe("bottom");
    expect(nearestBand(1)).toBe("bottom");
  });
});

describe("resizeFontFromDistance（拖角按距离等比缩放字号）", () => {
  it("距离翻倍 → 字号翻倍（clamp 内）", () => {
    // start 20px，距离从 100 拖到 200 → 40px
    expect(resizeFontFromDistance(20, 100, 200, 12, 48)).toBe(40);
  });
  it("距离减半 → 字号减半", () => {
    expect(resizeFontFromDistance(24, 100, 50, 12, 48)).toBe(12);
  });
  it("放大超上限 clamp 到 max", () => {
    expect(resizeFontFromDistance(40, 100, 400, 12, 48)).toBe(48);
  });
  it("缩小低于下限 clamp 到 min", () => {
    expect(resizeFontFromDistance(20, 100, 10, 12, 48)).toBe(12);
  });
  it("起始距离为 0 时按 max(startDist,1) 兜底不除零", () => {
    // startDist=0 → 分母取 1；curDist=30 → 20*30=600 → clamp 48
    expect(resizeFontFromDistance(20, 0, 30, 12, 48)).toBe(48);
  });
});
