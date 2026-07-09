import { describe, it, expect } from "vitest";
import { buildSceneStarts, sumDurations } from "@/services/video-synthesis";

describe("buildSceneStarts（成片时间轴前缀和，供字幕/配音/贴图同源对齐）", () => {
  it("按实测有效时长累计每镜起始秒", () => {
    // 三镜真实时长 8 / 5 / 10 → 起始 0 / 8 / 13
    expect(buildSceneStarts([8, 5, 10])).toEqual([0, 8, 13]);
  });

  it("空数组返回空", () => {
    expect(buildSceneStarts([])).toEqual([]);
  });

  it("单镜起始为 0", () => {
    expect(buildSceneStarts([7.5])).toEqual([0]);
  });

  it("小数时长精确累加（不因整型假设错位）", () => {
    // 真实视频常为 7.84 / 8.12 之类的非整值
    const starts = buildSceneStarts([7.84, 8.12]);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(7.84, 5);
  });
});

describe("sumDurations（成片总时长，BGM atrim/afade out 起点用）", () => {
  it("求各镜实测有效时长之和", () => {
    expect(sumDurations([8, 5, 10])).toBe(23);
  });

  it("空数组为 0", () => {
    expect(sumDurations([])).toBe(0);
  });

  it("与前缀和末位一致（末镜起始 + 末镜时长 = 总时长）", () => {
    const durs = [3.2, 8.1, 4.7];
    const starts = buildSceneStarts(durs);
    const total = sumDurations(durs);
    expect(starts[starts.length - 1] + durs[durs.length - 1]).toBeCloseTo(
      total,
      5
    );
  });
});
