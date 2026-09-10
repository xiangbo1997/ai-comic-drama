import { describe, expect, it } from "vitest";

import { applyEmotionSpeed, NARRATION_SPEED_FACTOR } from "@/lib/tts-emotion";

/**
 * 表演分层契约。
 *
 * 背景：旁白与对白此前共用同一个 emotion 和同一个语速——悲伤的镜头里两者都用
 * 1.1x 快语速冲过去，该慢的地方没慢下来；旁白还会跟着角色一起"愤怒"地念
 * 交代性文字（"三年后，林家大宅"用暴怒语气），听感极其怪异。
 *
 * 工业配置：旁白恒中性、慢 5-10%；对白按情绪浮动（愤怒/惊讶抢拍，悲伤/恐惧拖住）。
 */
describe("applyEmotionSpeed", () => {
  it("高唤醒情绪抢拍（愤怒/惊讶快于基准）", () => {
    expect(applyEmotionSpeed(1.0, "angry")).toBeGreaterThan(1.0);
    expect(applyEmotionSpeed(1.0, "surprised")).toBeGreaterThan(
      applyEmotionSpeed(1.0, "angry")
    );
  });

  it("低唤醒情绪拖住（悲伤慢于基准）", () => {
    expect(applyEmotionSpeed(1.0, "sad")).toBeLessThan(1.0);
  });

  it("neutral 不改变基准语速", () => {
    expect(applyEmotionSpeed(1.1, "neutral")).toBeCloseTo(1.1, 5);
  });

  it("空值 / 未知情绪返回基准值本身（零回归）", () => {
    expect(applyEmotionSpeed(1.1, null)).toBe(1.1);
    expect(applyEmotionSpeed(1.1, undefined)).toBe(1.1);
    expect(applyEmotionSpeed(1.1, "莫名其妙")).toBe(1.1);
  });

  it("大小写与空格不敏感", () => {
    expect(applyEmotionSpeed(1.0, "  ANGRY ")).toBe(
      applyEmotionSpeed(1.0, "angry")
    );
  });

  it("结果 clamp 到 provider 合法域 0.5-2.0", () => {
    // 用户已把基准调到 1.9，再乘 surprised 的 1.2 会越界
    expect(applyEmotionSpeed(1.9, "surprised")).toBeLessThanOrEqual(2.0);
    // 基准 0.55 再乘 sad 的 0.9 会低于下限
    expect(applyEmotionSpeed(0.55, "sad")).toBeGreaterThanOrEqual(0.5);
  });
});

describe("NARRATION_SPEED_FACTOR", () => {
  it("旁白慢于对白，但在 5-10% 的工业区间内", () => {
    expect(NARRATION_SPEED_FACTOR).toBeLessThan(1);
    expect(NARRATION_SPEED_FACTOR).toBeGreaterThanOrEqual(0.9);
  });

  it("同一情绪下旁白必定慢于对白——这是两者的核心区别", () => {
    const base = 1.1;
    const narration = base * NARRATION_SPEED_FACTOR;
    // 旁白不吃情绪，对白吃；愤怒镜里两者差距最大
    expect(narration).toBeLessThan(applyEmotionSpeed(base, "angry"));
    // 即便中性镜，旁白也略慢
    expect(narration).toBeLessThan(applyEmotionSpeed(base, "neutral"));
  });
});
