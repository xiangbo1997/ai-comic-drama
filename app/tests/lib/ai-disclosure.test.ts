/**
 * AI 生成内容提示标识（lib/ai-disclosure）纯函数单测。
 *
 * 这个模块是【合规兜底】——《微短剧管理办法》（广电总局令第 16 号，
 * 2026-09-01 施行）第三十四条要求 AI 生成制作的微短剧「每集明显位置添加提示标识」。
 *
 * 本测试守住三条最容易出错、出错后果最重的契约：
 * ① 缺省即启用（与项目里其他「缺省关」的可选功能相反）——存量项目不能静默
 *    导出成无标识成片；
 * ② 非法值回落默认而非抛错/关闭——绝不能因一个坏字段导致标识消失；
 * ③ 导出端与预览端共用的几何/时间窗判据一致（预览=成片铁律的数值基础）。
 */

import { describe, it, expect } from "vitest";
import {
  resolveAiDisclosure,
  disclosureTimeWindow,
  isDisclosureVisibleAt,
  disclosureAnchor,
  disclosureAssPos,
  DEFAULT_AI_DISCLOSURE,
  DISCLOSURE_MARGIN_RATIO,
  DISCLOSURE_TEXT_MAX_LEN,
  DISCLOSURE_FONT_SCALE_MIN,
  DISCLOSURE_FONT_SCALE_MAX,
  DISCLOSURE_HEAD_SEC_MAX,
} from "@/lib/ai-disclosure";

describe("resolveAiDisclosure · 缺省即启用（法定要求）", () => {
  it("config 整体缺省（老项目无此字段）→ 启用默认标识", () => {
    expect(resolveAiDisclosure(undefined)).toEqual(DEFAULT_AI_DISCLOSURE);
    expect(resolveAiDisclosure(null)).toEqual(DEFAULT_AI_DISCLOSURE);
  });

  it("enabled 字段缺省（只配了别的字段）→ 仍然启用", () => {
    const r = resolveAiDisclosure({ position: "bl" });
    expect(r.enabled).toBe(true);
    expect(r.position).toBe("bl");
  });

  it("仅显式 enabled:false 才关闭", () => {
    expect(resolveAiDisclosure({ enabled: false }).enabled).toBe(false);
    expect(resolveAiDisclosure({ enabled: true }).enabled).toBe(true);
  });

  it("返回的是副本，改返回值不污染 DEFAULT_AI_DISCLOSURE（不可变契约）", () => {
    const r = resolveAiDisclosure(undefined);
    r.text = "被改了";
    expect(DEFAULT_AI_DISCLOSURE.text).toBe("本片由 AI 生成");
  });
});

describe("resolveAiDisclosure · 非法值一律回落默认（绝不因坏字段丢标识）", () => {
  it("position / mode 落在枚举外 → 回落默认", () => {
    const r = resolveAiDisclosure({
      // 模拟脏数据（历史形态 / 手改 DB）
      position: "nowhere" as never,
      mode: "forever" as never,
    });
    expect(r.position).toBe(DEFAULT_AI_DISCLOSURE.position);
    expect(r.mode).toBe(DEFAULT_AI_DISCLOSURE.mode);
    // 关键：坏字段没让标识关掉
    expect(r.enabled).toBe(true);
  });

  it("空文案 / 纯空白 → 回落默认文案（不会渲染成空标识）", () => {
    expect(resolveAiDisclosure({ text: "" }).text).toBe(
      DEFAULT_AI_DISCLOSURE.text
    );
    expect(resolveAiDisclosure({ text: "   " }).text).toBe(
      DEFAULT_AI_DISCLOSURE.text
    );
  });

  it("超长文案被裁剪到上限（防压画面）", () => {
    const long = "超".repeat(DISCLOSURE_TEXT_MAX_LEN + 20);
    const r = resolveAiDisclosure({ text: long });
    expect(Array.from(r.text).length).toBe(DISCLOSURE_TEXT_MAX_LEN);
  });

  it("文案内换行/连续空白被折叠成单空格", () => {
    expect(resolveAiDisclosure({ text: "AI \n\n 生成" }).text).toBe("AI 生成");
  });

  it("fontScale / opacity / headSec 越界被夹到合法区间", () => {
    const low = resolveAiDisclosure({
      fontScale: -5,
      opacity: -1,
      headSec: -10,
    });
    expect(low.fontScale).toBe(DISCLOSURE_FONT_SCALE_MIN);
    expect(low.opacity).toBe(0);
    expect(low.headSec).toBeGreaterThan(0);

    const high = resolveAiDisclosure({
      fontScale: 99,
      opacity: 99,
      headSec: 9999,
    });
    expect(high.fontScale).toBe(DISCLOSURE_FONT_SCALE_MAX);
    expect(high.opacity).toBe(1);
    expect(high.headSec).toBe(DISCLOSURE_HEAD_SEC_MAX);
  });

  it("NaN 数值不会漏进结果（clamp 兜住非有限数）", () => {
    const r = resolveAiDisclosure({ fontScale: NaN, opacity: NaN });
    expect(Number.isFinite(r.fontScale)).toBe(true);
    expect(Number.isFinite(r.opacity)).toBe(true);
  });
});

describe("disclosureTimeWindow · 显示时间窗", () => {
  const base = resolveAiDisclosure(undefined);

  it("mode=always → 覆盖整片", () => {
    expect(disclosureTimeWindow({ ...base, mode: "always" }, 90)).toEqual({
      start: 0,
      end: 90,
    });
  });

  it("mode=head → 只覆盖片头 headSec", () => {
    const w = disclosureTimeWindow({ ...base, mode: "head", headSec: 5 }, 90);
    expect(w).toEqual({ start: 0, end: 5 });
  });

  it("mode=head 且 headSec 超过总时长 → 收敛到总时长（不越界）", () => {
    const w = disclosureTimeWindow({ ...base, mode: "head", headSec: 30 }, 8);
    expect(w).toEqual({ start: 0, end: 8 });
  });

  it("未启用 → null（不显示）", () => {
    expect(disclosureTimeWindow({ ...base, enabled: false }, 90)).toBeNull();
  });

  it("总时长非正 / 非有限 → null（无片可标）", () => {
    expect(disclosureTimeWindow(base, 0)).toBeNull();
    expect(disclosureTimeWindow(base, -5)).toBeNull();
    expect(disclosureTimeWindow(base, NaN)).toBeNull();
  });
});

describe("isDisclosureVisibleAt · 预览端逐帧判据（与导出端时间窗同源）", () => {
  const always = resolveAiDisclosure({ mode: "always" });
  const head = resolveAiDisclosure({ mode: "head", headSec: 5 });

  it("always 模式全程可见", () => {
    expect(isDisclosureVisibleAt(always, 0, 90)).toBe(true);
    expect(isDisclosureVisibleAt(always, 45, 90)).toBe(true);
    expect(isDisclosureVisibleAt(always, 89.9, 90)).toBe(true);
  });

  it("head 模式只在片头窗内可见，窗末为开区间（t=end 已不可见）", () => {
    expect(isDisclosureVisibleAt(head, 0, 90)).toBe(true);
    expect(isDisclosureVisibleAt(head, 4.9, 90)).toBe(true);
    expect(isDisclosureVisibleAt(head, 5, 90)).toBe(false);
    expect(isDisclosureVisibleAt(head, 10, 90)).toBe(false);
  });

  it("关闭时任何时刻都不可见", () => {
    const off = resolveAiDisclosure({ enabled: false });
    expect(isDisclosureVisibleAt(off, 0, 90)).toBe(false);
  });
});

describe("disclosureAnchor / disclosureAssPos · 双端共用几何", () => {
  it("六个位置各自映射到正确的 ASS \\an 对齐码与贴边方向", () => {
    expect(disclosureAnchor("tl")).toEqual({
      an: 7,
      hAlign: "left",
      vAlign: "top",
    });
    expect(disclosureAnchor("tr")).toEqual({
      an: 9,
      hAlign: "right",
      vAlign: "top",
    });
    expect(disclosureAnchor("bl")).toEqual({
      an: 1,
      hAlign: "left",
      vAlign: "bottom",
    });
    expect(disclosureAnchor("br")).toEqual({
      an: 3,
      hAlign: "right",
      vAlign: "bottom",
    });
    expect(disclosureAnchor("top")).toEqual({
      an: 8,
      hAlign: "center",
      vAlign: "top",
    });
    expect(disclosureAnchor("bottom")).toEqual({
      an: 2,
      hAlign: "center",
      vAlign: "bottom",
    });
  });

  it("ASS 锚点像素：边距恒为「画面宽 × 比例」，四角对称", () => {
    const W = 1080;
    const H = 1920;
    const margin = Math.round(W * DISCLOSURE_MARGIN_RATIO);

    expect(disclosureAssPos("tl", W, H)).toEqual({
      x: margin,
      y: margin,
      an: 7,
    });
    expect(disclosureAssPos("br", W, H)).toEqual({
      x: W - margin,
      y: H - margin,
      an: 3,
    });
  });

  it("居中位置 x 恒在画面中线", () => {
    expect(disclosureAssPos("top", 1080, 1920).x).toBe(540);
    expect(disclosureAssPos("bottom", 1080, 1920).x).toBe(540);
  });

  it("横屏画幅同样按画面宽算边距（跨画幅比例一致）", () => {
    const W = 1920;
    const H = 1080;
    const margin = Math.round(W * DISCLOSURE_MARGIN_RATIO);
    expect(disclosureAssPos("tr", W, H)).toEqual({
      x: W - margin,
      y: margin,
      an: 9,
    });
  });
});
