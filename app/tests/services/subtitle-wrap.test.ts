import { describe, it, expect } from "vitest";
import { wrapSubtitleText } from "@/services/video-synthesis";

describe("wrapSubtitleText（导出字幕折行，须与预览 90% 换行一致）", () => {
  it("CJK 全角按每行字数折行", () => {
    // 每行最多 5 个全角字
    const out = wrapSubtitleText("陈默盯着那个纸袋雨水顺着", 5);
    expect(out).toBe("陈默盯着那\n个纸袋雨水\n顺着");
  });

  it("短文本不折行", () => {
    expect(wrapSubtitleText("你好", 5)).toBe("你好");
    expect(wrapSubtitleText("刚好五个字符", 6)).toBe("刚好五个字符");
  });

  it("ASCII 计半宽（一行能放更多）", () => {
    // maxCharsPerLine=5，全角计1、半角计0.5 → 10 个 ASCII 才占满一行
    const out = wrapSubtitleText("abcdefghijkl", 5);
    // abcdefghij(10*0.5=5) 满，kl 换行
    expect(out).toBe("abcdefghij\nkl");
  });

  it("保留用户已有的显式换行，再对每段各自折行", () => {
    const out = wrapSubtitleText("第一行很长的文字\n第二行", 4);
    // 第一段按 4 字折，第二段单独一段
    expect(out).toBe("第一行很\n长的文字\n第二行");
  });

  it("空串与单字符不炸", () => {
    expect(wrapSubtitleText("", 5)).toBe("");
    expect(wrapSubtitleText("字", 5)).toBe("字");
  });

  it("单个字符即使超宽也不丢（至少成一行）", () => {
    // maxCharsPerLine=0 的极端不会传入（调用侧 Math.max(6,...)），
    // 但即便传 1，全角字也应各自成行不丢字
    const out = wrapSubtitleText("一二三", 1);
    expect(out).toBe("一\n二\n三");
  });
});
