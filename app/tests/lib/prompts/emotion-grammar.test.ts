import { describe, it, expect } from "vitest";
import {
  normalizeEmotion,
  inferEmotionIntensity,
  buildEmotionGrammar,
  buildEmotionPhrase,
} from "@/lib/prompts/emotion-grammar";

describe("normalizeEmotion", () => {
  it("英文枚举原样通过（大小写不敏感）", () => {
    expect(normalizeEmotion("angry")).toBe("angry");
    expect(normalizeEmotion("Angry")).toBe("angry");
    expect(normalizeEmotion("FEAR")).toBe("fear");
  });

  it("中文别名映射到规范值", () => {
    expect(normalizeEmotion("愤怒")).toBe("angry");
    expect(normalizeEmotion("震惊")).toBe("surprised");
    expect(normalizeEmotion("害怕")).toBe("fear");
    expect(normalizeEmotion("开心")).toBe("happy");
  });

  it("未知/空回落 neutral", () => {
    expect(normalizeEmotion("emo-xyz")).toBe("neutral");
    expect(normalizeEmotion("")).toBe("neutral");
    expect(normalizeEmotion(null)).toBe("neutral");
    expect(normalizeEmotion(undefined)).toBe("neutral");
  });
});

describe("inferEmotionIntensity", () => {
  it("显式 isClimax 直接 climax", () => {
    expect(inferEmotionIntensity("sad", "全景", true)).toBe("climax");
  });

  it("neutral 恒为 low", () => {
    expect(inferEmotionIntensity("neutral", "特写")).toBe("low");
    expect(inferEmotionIntensity(null, "特写")).toBe("low");
  });

  it("特写 + 高唤醒情绪（angry/surprised/fear）→ climax", () => {
    expect(inferEmotionIntensity("angry", "特写")).toBe("climax");
    expect(inferEmotionIntensity("fear", "extreme close-up")).toBe("climax");
  });

  it("非特写高唤醒 / 特写低唤醒 → medium", () => {
    expect(inferEmotionIntensity("angry", "全景")).toBe("medium");
    expect(inferEmotionIntensity("sad", "特写")).toBe("medium");
    expect(inferEmotionIntensity("happy", "中景")).toBe("medium");
  });
});

describe("buildEmotionGrammar 画风门控", () => {
  it("动漫系画风：表情 + 漫画符号皆非空（非中性高强度）", () => {
    const g = buildEmotionGrammar("angry", "climax", "anime");
    expect(g.expression.length).toBeGreaterThan(0);
    expect(g.symbols.length).toBeGreaterThan(0);
  });

  it("写实画风：有表情但漫画符号被禁用", () => {
    const g = buildEmotionGrammar("angry", "climax", "realistic");
    expect(g.expression.length).toBeGreaterThan(0);
    expect(g.symbols).toBe("");
  });

  it("neutral 表情与符号皆空", () => {
    const g = buildEmotionGrammar("neutral", "climax", "anime");
    expect(g.expression).toBe("");
    expect(g.symbols).toBe("");
  });

  it("强度递进：climax 短语不等于 low 短语", () => {
    const low = buildEmotionGrammar("angry", "low", "anime");
    const climax = buildEmotionGrammar("angry", "climax", "anime");
    expect(climax.expression).not.toBe(low.expression);
  });
});

describe("buildEmotionPhrase", () => {
  it("neutral 返回空串（调用方 filter 掉）", () => {
    expect(buildEmotionPhrase("neutral", "climax", "anime")).toBe("");
  });

  it("非中性拼接表情在前、符号在后", () => {
    const phrase = buildEmotionPhrase("angry", "climax", "anime");
    const g = buildEmotionGrammar("angry", "climax", "anime");
    expect(phrase).toBe(`${g.expression}, ${g.symbols}`);
  });

  it("写实画风只剩表情段（无符号无多余逗号）", () => {
    const phrase = buildEmotionPhrase("angry", "climax", "realistic");
    const g = buildEmotionGrammar("angry", "climax", "realistic");
    expect(phrase).toBe(g.expression);
    expect(phrase.endsWith(",")).toBe(false);
  });
});
