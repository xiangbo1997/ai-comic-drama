import { describe, it, expect } from "vitest";
import { normalizeSubtitleStyle } from "@/lib/subtitle-style-normalize";
import type { SubtitleStyle } from "@/types/export-style";

/** 对「已知为对象输入」的用例断言非 undefined 并收窄类型，避免逐处 ! 断言 */
function norm(input: unknown): SubtitleStyle {
  const r = normalizeSubtitleStyle(input);
  expect(r).toBeDefined();
  return r as SubtitleStyle;
}

describe("normalizeSubtitleStyle（服务端字幕样式白名单）", () => {
  it("非对象输入返回 undefined", () => {
    expect(normalizeSubtitleStyle(null)).toBeUndefined();
    expect(normalizeSubtitleStyle(undefined)).toBeUndefined();
    expect(normalizeSubtitleStyle("x")).toBeUndefined();
    expect(normalizeSubtitleStyle(42)).toBeUndefined();
  });

  it("空对象回退全部默认值", () => {
    expect(norm({})).toEqual({
      fontSize: 24,
      fontColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 2,
      position: "bottom",
      bold: false,
      backgroundBox: false,
      animation: "fade",
    });
  });

  // —— 核心回归：修复「animation 被静默丢弃」的 Bug ——
  it("保留合法 animation（此前被漏掉）", () => {
    for (const a of ["none", "fade", "slideup", "pop", "typewriter"] as const) {
      expect(norm({ animation: a }).animation).toBe(a);
    }
  });

  it("非法 animation 回退 fade", () => {
    expect(norm({ animation: "spin" }).animation).toBe("fade");
    expect(norm({ animation: 123 }).animation).toBe("fade");
  });

  it("fontSize 越界 clamp 到 8-96 安全外壳", () => {
    expect(norm({ fontSize: 5 }).fontSize).toBe(8);
    expect(norm({ fontSize: 200 }).fontSize).toBe(96);
    expect(norm({ fontSize: NaN }).fontSize).toBe(8);
  });

  it("非法颜色回退默认", () => {
    expect(norm({ fontColor: "red" }).fontColor).toBe("#FFFFFF");
    expect(norm({ fontColor: "#FFF" }).fontColor).toBe("#FFFFFF");
    expect(norm({ fontColor: "#12ab34" }).fontColor).toBe("#12ab34");
  });

  it("非法 position 回退 bottom；合法透传", () => {
    expect(norm({ position: "left" }).position).toBe("bottom");
    expect(norm({ position: "top" }).position).toBe("top");
  });

  it("bold/backgroundBox 严格布尔（仅 true 生效）", () => {
    const r = norm({ bold: 1, backgroundBox: "yes" });
    expect(r.bold).toBe(false);
    expect(r.backgroundBox).toBe(false);
    const r2 = norm({ bold: true, backgroundBox: true });
    expect(r2.bold).toBe(true);
    expect(r2.backgroundBox).toBe(true);
  });

  // —— 自由默认位置 defaultX/defaultY ——
  it("defaultX/defaultY 均为 number 时放行并 clamp", () => {
    const r = norm({ defaultX: 0.18, defaultY: 0.12 });
    expect(r.defaultX).toBe(0.18);
    expect(r.defaultY).toBe(0.12);
    const r2 = norm({ defaultX: -1, defaultY: 5 });
    expect(r2.defaultX).toBe(0);
    expect(r2.defaultY).toBe(1);
  });

  it("仅其一时二者都不输出（不采用半个坐标）", () => {
    const r = norm({ defaultX: 0.5 });
    expect(r.defaultX).toBeUndefined();
    expect(r.defaultY).toBeUndefined();
  });

  it("非有限数值（NaN/Infinity）不输出坐标", () => {
    const r = norm({ defaultX: NaN, defaultY: Infinity });
    expect(r.defaultX).toBeUndefined();
    expect(r.defaultY).toBeUndefined();
  });

  it("缺省时不长出 defaultX/defaultY 字段（老 payload 干净）", () => {
    const r = norm({ fontSize: 30 });
    expect("defaultX" in r).toBe(false);
    expect("defaultY" in r).toBe(false);
  });
});
