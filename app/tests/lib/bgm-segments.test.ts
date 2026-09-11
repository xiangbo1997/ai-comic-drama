import { describe, it, expect } from "vitest";
import {
  planBgmSegments,
  MIN_BGM_SEGMENT_SEC,
  BGM_CROSSFADE_SEC,
} from "@/lib/bgm-segments";

/** 由各镜时长推出起始时刻（与导出端 buildSceneStarts 同语义） */
function startsOf(durations: number[]): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const d of durations) {
    out.push(cursor);
    cursor += d;
  }
  return out;
}

/** 断言分段首尾相接、无空隙、总时长守恒 */
function expectContiguous(
  segs: { startSec: number; endSec: number }[],
  total: number
) {
  expect(segs[0].startSec).toBe(0);
  expect(segs[segs.length - 1].endSec).toBeCloseTo(total, 6);
  for (let i = 1; i < segs.length; i += 1) {
    expect(segs[i].startSec).toBeCloseTo(segs[i - 1].endSec, 6);
  }
}

describe("planBgmSegments（BGM 情绪分段调度）", () => {
  it("空输入返回空数组", () => {
    expect(planBgmSegments([], [], [])).toEqual([]);
  });

  it("全片单一情绪 → 退化为单段（与原「全片一首」行为等价）", () => {
    const dur = [10, 10, 10];
    const segs = planBgmSegments(
      [{ emotion: "neutral" }, { emotion: "neutral" }, { emotion: "neutral" }],
      startsOf(dur),
      dur
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ category: "calm", startSec: 0, endSec: 30 });
  });

  it("连续同情绪合并、换情绪断段", () => {
    const dur = [10, 10, 10, 10];
    const segs = planBgmSegments(
      [
        { emotion: "neutral" },
        { emotion: "neutral" },
        { emotion: "sad" },
        { emotion: "sad" },
      ],
      startsOf(dur),
      dur
    );
    expect(segs.map((s) => s.category)).toEqual(["calm", "sad"]);
    expectContiguous(segs, 40);
  });

  it("情绪映射复用 emotion-bgm 单一真源（angry→tension, happy→upbeat, fear→suspense）", () => {
    const dur = [10, 10, 10];
    const segs = planBgmSegments(
      [{ emotion: "angry" }, { emotion: "happy" }, { emotion: "fear" }],
      startsOf(dur),
      dur
    );
    expect(segs.map((s) => s.category)).toEqual([
      "tension",
      "upbeat",
      "suspense",
    ]);
  });

  it("未知/空情绪回落 calm，不抛错", () => {
    const dur = [10, 10];
    const segs = planBgmSegments(
      [{ emotion: "煮咖啡" }, { emotion: null }],
      startsOf(dur),
      dur
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].category).toBe("calm");
  });

  it("isClimax 强制断段——即使与前一镜同情绪（高潮是情绪转折点）", () => {
    const dur = [12, 12, 12];
    const segs = planBgmSegments(
      [
        { emotion: "angry" },
        { emotion: "angry", isClimax: true },
        { emotion: "angry" },
      ],
      startsOf(dur),
      dur
    );
    // 三镜同为 angry，但第二镜是高潮 → 断成 2 段（第 2、3 镜并成一段）
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0]).toEqual({ category: "tension", startSec: 0, endSec: 12 });
    expectContiguous(segs, 36);
  });

  it("短于下限的段被合并，且合并后无段短于下限（除非只剩一段）", () => {
    // 中间 sad 段仅 2s，远短于 8s 下限
    const dur = [20, 2, 20];
    const segs = planBgmSegments(
      [{ emotion: "neutral" }, { emotion: "sad" }, { emotion: "happy" }],
      startsOf(dur),
      dur
    );
    for (const s of segs) {
      if (segs.length > 1) {
        expect(s.endSec - s.startSec).toBeGreaterThanOrEqual(
          MIN_BGM_SEGMENT_SEC
        );
      }
    }
    expectContiguous(segs, 42);
  });

  it("短段并入「时长更长的相邻段」，采用长段的情绪", () => {
    // neutral 30s | sad 3s | happy 10s → sad 应并入更长的 neutral(30s)
    const dur = [30, 3, 10];
    const segs = planBgmSegments(
      [{ emotion: "neutral" }, { emotion: "sad" }, { emotion: "happy" }],
      startsOf(dur),
      dur
    );
    expect(segs.map((s) => s.category)).toEqual(["calm", "upbeat"]);
    expect(segs[0].endSec).toBe(33); // sad 的 3s 被 calm 吸收
    expectContiguous(segs, 43);
  });

  it("全片过短（合并到只剩一段）时不崩，返回单段覆盖全片", () => {
    const dur = [2, 2, 2];
    const segs = planBgmSegments(
      [{ emotion: "neutral" }, { emotion: "sad" }, { emotion: "angry" }],
      startsOf(dur),
      dur
    );
    expect(segs).toHaveLength(1);
    expectContiguous(segs, 6);
  });

  it("典型一集（多情绪转折）产出 2-6 段，符合行业常态", () => {
    const dur = [10, 10, 10, 10, 10, 10, 10, 10];
    const segs = planBgmSegments(
      [
        { emotion: "neutral" },
        { emotion: "neutral" },
        { emotion: "angry" },
        { emotion: "angry" },
        { emotion: "sad" },
        { emotion: "sad" },
        { emotion: "happy" },
        { emotion: "happy" },
      ],
      startsOf(dur),
      dur
    );
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.length).toBeLessThanOrEqual(6);
    expectContiguous(segs, 80);
  });

  it("结果确定性：同输入多次调用结果一致（单测可复现）", () => {
    const dur = [9, 3, 9, 4, 9];
    const scenes = [
      { emotion: "neutral" },
      { emotion: "sad" },
      { emotion: "angry" },
      { emotion: "happy" },
      { emotion: "fear" },
    ];
    const a = planBgmSegments(scenes, startsOf(dur), dur);
    const b = planBgmSegments(scenes, startsOf(dur), dur);
    expect(a).toEqual(b);
  });

  it("不修改入参（纯函数，无副作用）", () => {
    const dur = [20, 2, 20];
    const durCopy = [...dur];
    const scenes = [
      { emotion: "neutral" },
      { emotion: "sad" },
      { emotion: "happy" },
    ];
    const scenesCopy = JSON.parse(JSON.stringify(scenes));
    planBgmSegments(scenes, startsOf(dur), dur);
    expect(dur).toEqual(durCopy);
    expect(scenes).toEqual(scenesCopy);
  });

  it("交叉淡化常量落在行业区间 1.5-2.5s", () => {
    expect(BGM_CROSSFADE_SEC).toBeGreaterThanOrEqual(1.5);
    expect(BGM_CROSSFADE_SEC).toBeLessThanOrEqual(2.5);
  });
});
