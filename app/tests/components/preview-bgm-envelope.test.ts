import { describe, it, expect } from "vitest";
import {
  bgmVolumeAt,
  BGM_DUCKING_FACTOR,
  type BgmEnvelopeConfig,
} from "@/components/preview-bgm-envelope";

const base: BgmEnvelopeConfig = {
  volume: 0.4,
  fadeIn: 2,
  fadeOut: 3,
  ducking: false,
};

describe("bgmVolumeAt（BGM 音量包络，近似导出端 buildBgmFilter）", () => {
  const total = 30; // 整片 30s

  it("淡入：起播 fadeIn 秒内线性从 0 升到 base", () => {
    expect(bgmVolumeAt(base, 0, total, false)).toBeCloseTo(0);
    expect(bgmVolumeAt(base, 1, total, false)).toBeCloseTo(0.2); // 0.4 * (1/2)
    expect(bgmVolumeAt(base, 2, total, false)).toBeCloseTo(0.4); // 到 base
  });

  it("平稳段：淡入后、淡出前恒为 base", () => {
    expect(bgmVolumeAt(base, 10, total, false)).toBeCloseTo(0.4);
    expect(bgmVolumeAt(base, 26.9, total, false)).toBeCloseTo(0.4);
  });

  it("淡出：整片结束前 fadeOut 秒线性从 base 降到 0", () => {
    // fadeOutStart = 30 - 3 = 27
    expect(bgmVolumeAt(base, 27, total, false)).toBeCloseTo(0.4);
    expect(bgmVolumeAt(base, 28.5, total, false)).toBeCloseTo(0.2); // 剩 1.5s → 0.4*(1.5/3)
    expect(bgmVolumeAt(base, 30, total, false)).toBeCloseTo(0);
  });

  it("ducking=false 时对白在播也不压低", () => {
    expect(bgmVolumeAt(base, 10, total, true)).toBeCloseTo(0.4);
  });

  it("ducking=true 且对白在播 → 乘固定衰减系数", () => {
    const cfg = { ...base, ducking: true };
    expect(bgmVolumeAt(cfg, 10, total, true)).toBeCloseTo(
      0.4 * BGM_DUCKING_FACTOR
    );
  });

  it("ducking=true 但无对白 → 不压低（保持 base）", () => {
    const cfg = { ...base, ducking: true };
    expect(bgmVolumeAt(cfg, 10, total, false)).toBeCloseTo(0.4);
  });

  it("ducking 叠加在淡入之上（淡入期 + 对白 → 两者相乘）", () => {
    const cfg = { ...base, ducking: true };
    // t=1 淡入到 0.2，再 ducking 压到 0.2 * 0.3
    expect(bgmVolumeAt(cfg, 1, total, true)).toBeCloseTo(
      0.2 * BGM_DUCKING_FACTOR
    );
  });

  it("fadeIn=0 / fadeOut=0 时跳过对应渐变（全程 base）", () => {
    const cfg: BgmEnvelopeConfig = {
      volume: 0.5,
      fadeIn: 0,
      fadeOut: 0,
      ducking: false,
    };
    expect(bgmVolumeAt(cfg, 0, total, false)).toBeCloseTo(0.5);
    expect(bgmVolumeAt(cfg, total, total, false)).toBeCloseTo(0.5);
  });

  it("音量 clamp 到 0-1（异常配置不越界）", () => {
    const cfg: BgmEnvelopeConfig = {
      volume: 2,
      fadeIn: 0,
      fadeOut: 0,
      ducking: false,
    };
    expect(bgmVolumeAt(cfg, 5, total, false)).toBe(1);
  });
});
