import { describe, it, expect } from "vitest";
import {
  estimateSpeechSeconds,
  computeShotDuration,
  isTrimExemptShot,
} from "@/lib/shot-timing";

describe("estimateSpeechSeconds", () => {
  it("空文本返回 0", () => {
    expect(estimateSpeechSeconds("")).toBe(0);
    expect(estimateSpeechSeconds("   ")).toBe(0);
  });

  it("中文按 2.5 字/秒", () => {
    // 10 个汉字 → 4 秒
    expect(estimateSpeechSeconds("一二三四五六七八九十")).toBeCloseTo(4, 5);
    // 5 个汉字 → 2 秒
    expect(estimateSpeechSeconds("你好世界啊")).toBeCloseTo(2, 5);
  });

  it("标点不计入朗读时长", () => {
    // 5 汉字 + 标点 → 仍是 2 秒（标点被忽略，只数「你好世界啊」5 字）
    expect(estimateSpeechSeconds("你好世界啊，！")).toBeCloseTo(2, 5);
  });

  it("英文按词数 / 2.5", () => {
    // 5 个词 → 2 秒
    expect(estimateSpeechSeconds("one two three four five")).toBeCloseTo(2, 5);
  });

  it("中英混排叠加", () => {
    // 5 汉字(2s) + 2 词(0.8s) = 2.8s
    expect(estimateSpeechSeconds("你好世界啊 hello world")).toBeCloseTo(2.8, 5);
  });
});

describe("computeShotDuration", () => {
  it("无对白空镜：按景别派生", () => {
    // 全景无对白 base=3.5 → 4（向上取整）
    expect(
      computeShotDuration({ shotType: "全景", dialogue: null, narration: null })
    ).toBe(4);
    // 特写无对白 base=2.5 → 3
    expect(
      computeShotDuration({ shotType: "特写", dialogue: null, narration: null })
    ).toBe(3);
  });

  it("快节奏情绪的空镜更短", () => {
    // 特写 base=2.5 * 0.7 = 1.75 → 2（angry 快情绪）
    expect(computeShotDuration({ shotType: "特写", emotion: "angry" })).toBe(2);
  });

  it("对白镜不短于朗读时长", () => {
    // 25 汉字 → 10 秒朗读；即使景别下限只有 1.5，也必须 >= 10
    const d = computeShotDuration({
      shotType: "近景",
      dialogue: "这是一句非常非常长的台词用来测试朗读时长的下限约束是否生效呀",
    });
    expect(d).toBeGreaterThanOrEqual(10);
  });

  it("LLM 把对白镜填太短时强制补齐", () => {
    // 10 汉字对白 → 4s 朗读；LLM 只给 1s，应被补到 >= 4
    const d = computeShotDuration({
      shotType: "近景",
      dialogue: "一二三四五六七八九十",
      llmDuration: 1,
    });
    expect(d).toBeGreaterThanOrEqual(4);
  });

  it("LLM 合理值被采信", () => {
    // 10 汉字对白 4s 下限；LLM 给 5（在 [4, 8] 内）→ 采信 5
    const d = computeShotDuration({
      shotType: "近景",
      dialogue: "一二三四五六七八九十",
      llmDuration: 5,
    });
    expect(d).toBe(5);
  });

  it("空镜被 LLM 拉太长时夹回上限", () => {
    // 无对白 LLM 给 30s（凑时长）→ 夹回软上限 8
    const d = computeShotDuration({
      shotType: "中景",
      llmDuration: 30,
    });
    expect(d).toBeLessThanOrEqual(8);
  });

  it("旁白也计入朗读下限", () => {
    // 20 汉字旁白 → 8s；无对白但旁白要念完
    const d = computeShotDuration({
      shotType: "远景",
      narration: "夜色如墨缓缓浸透了整座沉睡的孤城无人知晓那场风暴将至",
    });
    expect(d).toBeGreaterThanOrEqual(8);
  });

  it("对白 + 旁白时长叠加", () => {
    // 10 汉字对白(4s) + 10 汉字旁白(4s) = 8s 下限
    const d = computeShotDuration({
      shotType: "近景",
      dialogue: "一二三四五六七八九十",
      narration: "甲乙丙丁戊己庚辛壬癸",
    });
    expect(d).toBeGreaterThanOrEqual(8);
  });

  it("结果始终为 [1,60] 的整数", () => {
    const d = computeShotDuration({
      shotType: "特写",
      dialogue: "短",
      llmDuration: 999,
    });
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(60);
  });

  it("未知景别有兜底", () => {
    // 未知景别无对白 → base 3 → 3
    expect(computeShotDuration({ shotType: "怪景别" })).toBe(3);
    // 完全空输入 → 3
    expect(computeShotDuration({})).toBe(3);
  });
});

describe("isTrimExemptShot — 裁剪豁免（批2）", () => {
  it("快节奏情绪（angry/surprised/fear）豁免", () => {
    expect(isTrimExemptShot({ emotion: "angry" })).toBe(true);
    expect(isTrimExemptShot({ emotion: "surprised" })).toBe(true);
    expect(isTrimExemptShot({ emotion: "fear" })).toBe(true);
  });

  it("普通情绪不豁免", () => {
    expect(isTrimExemptShot({ emotion: "neutral" })).toBe(false);
    expect(isTrimExemptShot({ emotion: "sad" })).toBe(false);
    expect(isTrimExemptShot({ emotion: null })).toBe(false);
  });

  it("有非空 actionBeat 豁免（动作镜）", () => {
    expect(isTrimExemptShot({ actionBeat: "挥拳砸向敌人" })).toBe(true);
    // 空白 actionBeat 不豁免
    expect(isTrimExemptShot({ actionBeat: "   " })).toBe(false);
    expect(isTrimExemptShot({ actionBeat: null })).toBe(false);
  });

  it("长镜（目标 ≥6s）豁免", () => {
    expect(isTrimExemptShot({ targetDuration: 6 })).toBe(true);
    expect(isTrimExemptShot({ targetDuration: 12 })).toBe(true);
    expect(isTrimExemptShot({ targetDuration: 4 })).toBe(false);
    expect(isTrimExemptShot({ targetDuration: null })).toBe(false);
  });

  it("全部为常规值 → 不豁免（裁剪，恢复快节奏）", () => {
    expect(
      isTrimExemptShot({
        emotion: "neutral",
        actionBeat: null,
        targetDuration: 3,
      })
    ).toBe(false);
  });
});
