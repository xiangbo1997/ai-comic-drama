import { describe, it, expect } from "vitest";
import { isStickerVisibleAt } from "@/components/preview-sticker-window";

describe("isStickerVisibleAt（贴图时间窗判定，与导出端 prepareStickers 同源）", () => {
  const effDur = 5; // 该镜有效时长 5s

  it("无 startOffset / duration → 全镜可见（0..effDur）", () => {
    expect(isStickerVisibleAt({}, 0, effDur)).toBe(true);
    expect(isStickerVisibleAt({}, 2.5, effDur)).toBe(true);
    // 右开区间：t === effDur 不显示
    expect(isStickerVisibleAt({}, 5, effDur)).toBe(false);
  });

  it("有 startOffset：偏移前不显示，到偏移点开始显示（左闭）", () => {
    const st = { startOffset: 2 };
    expect(isStickerVisibleAt(st, 1.99, effDur)).toBe(false);
    expect(isStickerVisibleAt(st, 2, effDur)).toBe(true); // 含起点
    expect(isStickerVisibleAt(st, 4.9, effDur)).toBe(true);
  });

  it("有 duration：窗口 [startOffset, startOffset+duration)（右开）", () => {
    const st = { startOffset: 1, duration: 2 };
    expect(isStickerVisibleAt(st, 0.9, effDur)).toBe(false);
    expect(isStickerVisibleAt(st, 1, effDur)).toBe(true);
    expect(isStickerVisibleAt(st, 2.99, effDur)).toBe(true);
    expect(isStickerVisibleAt(st, 3, effDur)).toBe(false); // 含终点则应为 false
    expect(isStickerVisibleAt(st, 4, effDur)).toBe(false);
  });

  it("duration 超出镜尾 → 截断到镜尾（与导出端 min 一致）", () => {
    const st = { startOffset: 4, duration: 10 }; // 4+10=14 但镜尾 5
    expect(isStickerVisibleAt(st, 4, effDur)).toBe(true);
    expect(isStickerVisibleAt(st, 4.9, effDur)).toBe(true);
    // 超过镜尾不显示（endRel 被 min 截到 effDur=5，右开故 5 不显示）
    expect(isStickerVisibleAt(st, 5, effDur)).toBe(false);
    expect(isStickerVisibleAt(st, 6, effDur)).toBe(false);
  });

  it("duration=0 → 空窗口，任何时刻都不显示", () => {
    const st = { startOffset: 1, duration: 0 };
    expect(isStickerVisibleAt(st, 1, effDur)).toBe(false);
  });
});
