import { describe, expect, it } from "vitest";

import {
  reconcileDuration,
  LEAD_IN_SEC,
  TAIL_SEC,
  MAX_STRETCH_RATIO,
  MAX_SPEEDUP,
} from "@/lib/av-duration-reconcile";

/**
 * 音画协调契约。
 *
 * 专业剪辑里声音是主时间轴、画面服从声音；截断台词是绝对禁止的。
 * 图片镜用 `-t declaredDuration` 钉死时长，配音更长时会切掉半句台词——
 * 三种触发场景：用户调短 duration、用户调慢 ttsSpeed、情绪语速让配音变长。
 */
describe("reconcileDuration", () => {
  it("画面本就够长时原样返回（多出来的是正常留白）", () => {
    const r = reconcileDuration(5, 2);
    expect(r.duration).toBe(5);
    expect(r.stretched).toBe(false);
    expect(r.suggestedSpeedup).toBe(1);
  });

  it("配音略长时延长画面到刚好装下（含头尾呼吸空隙）", () => {
    // 配音 3s + 0.15 + 0.35 = 3.5s，画面 3s → 延长到 3.5s（未超 1.25 倍上限 3.75）
    const r = reconcileDuration(3, 3);
    expect(r.duration).toBeCloseTo(3 + LEAD_IN_SEC + TAIL_SEC, 3);
    expect(r.stretched).toBe(true);
    expect(r.suggestedSpeedup).toBe(1);
  });

  it("配音远超画面时延长到上限并建议提速", () => {
    // 配音 6s + 0.5 = 6.5s 远超画面 3s 的 1.25 倍（3.75s）
    const r = reconcileDuration(3, 6);
    expect(r.duration).toBeCloseTo(3 * MAX_STRETCH_RATIO, 3);
    expect(r.suggestedSpeedup).toBeGreaterThan(1);
    expect(r.stretched).toBe(true);
  });

  it("建议提速钳到 1.15——超过人耳可察觉失真（金属感/卡顿）", () => {
    // 极端：配音 30s 对画面 2s
    const r = reconcileDuration(2, 30);
    expect(r.suggestedSpeedup).toBeLessThanOrEqual(MAX_SPEEDUP);
  });

  it("画面绝不会被延长超过 1.25 倍——短剧 ASL 目标 2.0-2.8s 不能被单镜破坏", () => {
    for (const voice of [4, 10, 30, 100]) {
      const r = reconcileDuration(3, voice);
      expect(r.duration).toBeLessThanOrEqual(3 * MAX_STRETCH_RATIO + 0.001);
    }
  });

  it("无配音 / 探测失败时零回归（原样返回，不标记延长）", () => {
    for (const voice of [undefined, 0, -1]) {
      const r = reconcileDuration(4, voice);
      expect(r.duration).toBe(4);
      expect(r.stretched).toBe(false);
      expect(r.suggestedSpeedup).toBe(1);
    }
  });

  it("画面时长非法时不做任何协调", () => {
    expect(reconcileDuration(0, 5).duration).toBe(0);
    expect(reconcileDuration(-1, 5).stretched).toBe(false);
  });

  it("结果为毫秒精度——浮点尾数会污染 ffmpeg 参数与后续前缀和", () => {
    const r = reconcileDuration(3.3333333, 3.1111111);
    expect(r.duration.toString()).toMatch(/^\d+(\.\d{1,3})?$/);
  });

  it("延长后的画面必定装得下配音加呼吸空隙（除非触发提速分支）", () => {
    const clip = 3;
    const voice = 3.2;
    const r = reconcileDuration(clip, voice);
    if (r.suggestedSpeedup === 1) {
      expect(r.duration).toBeGreaterThanOrEqual(voice + LEAD_IN_SEC + TAIL_SEC);
    }
  });
});
