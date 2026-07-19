import { describe, it, expect } from "vitest";
import {
  SHAKE_PARAMS,
  FLASH_PARAMS,
  KEN_BURNS_PARAMS,
  shakeOffsetAt,
  flashIntensityAt,
} from "@/lib/impact-effect-params";

describe("shakeOffsetAt（导出/预览同源正弦位移）", () => {
  it("窗外（t<0 或 t≥durationSec）恒为 0——画面归位无残余", () => {
    expect(shakeOffsetAt(-0.1, "light")).toBe(0);
    expect(shakeOffsetAt(SHAKE_PARAMS.durationSec, "heavy")).toBe(0);
    expect(shakeOffsetAt(10, "heavy")).toBe(0);
  });

  it("窗内位移不超过峰值振幅", () => {
    for (const intensity of ["light", "heavy"] as const) {
      const peak = SHAKE_PARAMS[intensity].amplitudePx;
      for (let t = 0; t < SHAKE_PARAMS.durationSec; t += 0.02) {
        expect(Math.abs(shakeOffsetAt(t, intensity))).toBeLessThanOrEqual(peak);
      }
    }
  });

  it("线性衰减：窗尾附近的包络显著小于窗头", () => {
    // 取各自频率的四分之一周期采样点（sin=1 处），对比包络
    const quarterCycle = (hz: number) => 1 / (4 * hz);
    const early = Math.abs(
      shakeOffsetAt(quarterCycle(SHAKE_PARAMS.heavy.frequencyHz), "heavy")
    );
    const late = Math.abs(
      shakeOffsetAt(
        SHAKE_PARAMS.durationSec - quarterCycle(SHAKE_PARAMS.heavy.frequencyHz),
        "heavy"
      )
    );
    expect(early).toBeGreaterThan(late);
  });
});

describe("flashIntensityAt（三角脉冲）", () => {
  it("窗外恒 0，中点达峰值", () => {
    expect(flashIntensityAt(-0.01)).toBe(0);
    expect(flashIntensityAt(FLASH_PARAMS.durationSec)).toBe(0);
    expect(flashIntensityAt(FLASH_PARAMS.durationSec / 2)).toBeCloseTo(
      FLASH_PARAMS.peakBrightness,
      5
    );
  });

  it("前半程递增后半程递减", () => {
    const q = FLASH_PARAMS.durationSec / 4;
    expect(flashIntensityAt(q)).toBeLessThan(flashIntensityAt(2 * q));
    expect(flashIntensityAt(3 * q)).toBeLessThan(flashIntensityAt(2 * q));
  });
});

describe("KEN_BURNS_PARAMS 约束", () => {
  it("缩放上限克制（≤1.2 防糊）且 fps 为正", () => {
    expect(KEN_BURNS_PARAMS.maxScale).toBeGreaterThan(1);
    expect(KEN_BURNS_PARAMS.maxScale).toBeLessThanOrEqual(1.2);
    expect(KEN_BURNS_PARAMS.fps).toBeGreaterThan(0);
  });
});
