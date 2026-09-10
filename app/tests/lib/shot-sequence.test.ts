import { describe, it, expect } from "vitest";
import {
  analyzeShotSequence,
  shotScaleIndex,
  suggestContrastScale,
  SHOT_SCALE_ORDER,
  type ShotSequenceScene,
} from "@/lib/shot-sequence";

/** 便捷构造：按顺序给一串景别，order 从 0 递增 */
function seq(
  shots: (string | null)[],
  locations?: (string | null)[]
): ShotSequenceScene[] {
  return shots.map((shotType, i) => ({
    order: i,
    shotType,
    locationKey: locations?.[i] ?? null,
  }));
}

describe("shotScaleIndex", () => {
  it("标准五景别按取景范围从紧到松排序", () => {
    expect(shotScaleIndex("特写")).toBe(0);
    expect(shotScaleIndex("近景")).toBe(1);
    expect(shotScaleIndex("中景")).toBe(2);
    expect(shotScaleIndex("全景")).toBe(3);
    expect(shotScaleIndex("远景")).toBe(4);
    expect(SHOT_SCALE_ORDER).toHaveLength(5);
  });

  it("复用 B1 归一：复合值与别名都能识别", () => {
    expect(shotScaleIndex("大特写·急推")).toBe(0);
    expect(shotScaleIndex("大全景·缓推")).toBe(4);
    expect(shotScaleIndex("半身")).toBe(1);
    expect(shotScaleIndex("中景→特写·快速推近")).toBe(0);
  });

  it("机位角度键不是景别，返回 null 排除出级差判据", () => {
    // 把「俯拍」当景别参与级差排序是错的
    expect(shotScaleIndex("俯拍")).toBeNull();
    expect(shotScaleIndex("过肩")).toBeNull();
    expect(shotScaleIndex("斜角")).toBeNull();
  });

  it("空值 / 乱输入 → null", () => {
    expect(shotScaleIndex(null)).toBeNull();
    expect(shotScaleIndex(undefined)).toBeNull();
    expect(shotScaleIndex("")).toBeNull();
    expect(shotScaleIndex("asdf")).toBeNull();
  });
});

describe("analyzeShotSequence · 连续同景别", () => {
  it("连续 3 镜同景别被抓出", () => {
    const r = analyzeShotSequence(seq(["中景", "中景", "中景"]));
    expect(r.sameScaleRuns).toEqual([
      { startOrder: 0, length: 3, scale: "中景" },
    ]);
  });

  it("连续 2 镜同景别不算违规（阈值为 3）", () => {
    const r = analyzeShotSequence(seq(["中景", "中景", "特写"]));
    expect(r.sameScaleRuns).toEqual([]);
  });

  it("正确的跨档序列无违规", () => {
    // 远景 → 中景 → 特写
    const r = analyzeShotSequence(seq(["远景", "中景", "特写"]));
    expect(r.sameScaleRuns).toEqual([]);
    expect(r.flatTransitions).toEqual([]);
  });

  it("复合值路径同样能抓出连坐（B1 归一生效）", () => {
    const r = analyzeShotSequence(seq(["大特写·急推", "特写·固定", "极特写"]));
    expect(r.sameScaleRuns).toEqual([
      { startOrder: 0, length: 3, scale: "特写" },
    ]);
  });

  it("未知景别镜打断连续段，不并入任何一段", () => {
    // 中景 中景 [俯拍] 中景 中景 → 两段各 2 镜，都不足 3
    const r = analyzeShotSequence(
      seq(["中景", "中景", "俯拍", "中景", "中景"])
    );
    expect(r.sameScaleRuns).toEqual([]);
  });

  it("多段连坐分别记录", () => {
    const r = analyzeShotSequence(
      seq(["中景", "中景", "中景", "特写", "全景", "全景", "全景", "全景"])
    );
    expect(r.sameScaleRuns).toEqual([
      { startOrder: 0, length: 3, scale: "中景" },
      { startOrder: 4, length: 4, scale: "全景" },
    ]);
  });
});

describe("analyzeShotSequence · 相邻级差", () => {
  it("级差为 0 的镜对被记录（记后一镜 order）", () => {
    const r = analyzeShotSequence(seq(["中景", "中景", "特写"]));
    expect(r.flatTransitions).toEqual([{ order: 1 }]);
    expect(r.comparablePairs).toBe(2);
  });

  it("相邻对中任一为未知景别则跳过该对", () => {
    const r = analyzeShotSequence(seq(["中景", "俯拍", "中景"]));
    expect(r.flatTransitions).toEqual([]);
    expect(r.comparablePairs).toBe(0);
  });

  it("全片跨档时无 flat", () => {
    const r = analyzeShotSequence(seq(["远景", "中景", "特写", "全景"]));
    expect(r.flatTransitions).toEqual([]);
    expect(r.comparablePairs).toBe(3);
  });
});

describe("analyzeShotSequence · 特写占比", () => {
  it("特写+近景占比正确，分母只算可识别景别", () => {
    const r = analyzeShotSequence(seq(["特写", "近景", "中景", "俯拍"]));
    expect(r.recognizedCount).toBe(3);
    expect(r.closeUpRatio).toBeCloseTo(2 / 3);
  });

  it("无可识别景别时占比为 0，不除零", () => {
    const r = analyzeShotSequence(seq(["俯拍", null]));
    expect(r.recognizedCount).toBe(0);
    expect(r.closeUpRatio).toBe(0);
  });
});

describe("analyzeShotSequence · 建立镜", () => {
  it("地点首镜为全景/远景 → 无告警", () => {
    const r = analyzeShotSequence(
      seq(["远景", "中景", "特写"], ["茶楼", "茶楼", "茶楼"])
    );
    expect(r.missingEstablishing).toEqual([]);
  });

  it("地点首镜为特写 → 缺建立镜", () => {
    const r = analyzeShotSequence(seq(["特写", "中景"], ["密室", "密室"]));
    expect(r.missingEstablishing).toEqual([
      { locationKey: "密室", firstOrder: 0 },
    ]);
  });

  it("多地点各自独立判定，只看每个地点的首镜", () => {
    const r = analyzeShotSequence(
      seq(["远景", "特写", "中景", "近景"], ["茶楼", "茶楼", "码头", "码头"])
    );
    // 茶楼首镜远景 OK；码头首镜中景 → 缺建立镜
    expect(r.missingEstablishing).toEqual([
      { locationKey: "码头", firstOrder: 2 },
    ]);
  });

  it("无 locationKey 的镜不参与建立镜判定", () => {
    const r = analyzeShotSequence(seq(["特写", "中景"]));
    expect(r.missingEstablishing).toEqual([]);
  });

  it("首镜景别不可识别时不下结论（缺数据 ≠ 缺建立镜）", () => {
    const r = analyzeShotSequence(seq(["俯拍", "中景"], ["密室", "密室"]));
    expect(r.missingEstablishing).toEqual([]);
  });
});

describe("analyzeShotSequence · 边界", () => {
  it("空数组不崩", () => {
    const r = analyzeShotSequence([]);
    expect(r.sameScaleRuns).toEqual([]);
    expect(r.flatTransitions).toEqual([]);
    expect(r.closeUpRatio).toBe(0);
    expect(r.recognizedCount).toBe(0);
    expect(r.comparablePairs).toBe(0);
  });

  it("单镜无相邻对", () => {
    const r = analyzeShotSequence(seq(["中景"]));
    expect(r.comparablePairs).toBe(0);
    expect(r.flatTransitions).toEqual([]);
  });

  it("乱序输入按 order 排序后分析，不改入参", () => {
    const scenes: ShotSequenceScene[] = [
      { order: 2, shotType: "中景" },
      { order: 0, shotType: "中景" },
      { order: 1, shotType: "中景" },
    ];
    const snapshot = JSON.parse(JSON.stringify(scenes));
    const r = analyzeShotSequence(scenes);
    expect(r.sameScaleRuns).toEqual([
      { startOrder: 0, length: 3, scale: "中景" },
    ]);
    expect(scenes).toEqual(snapshot);
  });
});

describe("suggestContrastScale", () => {
  it("给出跨档的替换景别", () => {
    expect(suggestContrastScale("特写")).toBe("全景");
    expect(suggestContrastScale("近景")).toBe("全景");
    expect(suggestContrastScale("全景")).toBe("特写");
    expect(suggestContrastScale("远景")).toBe("特写");
    expect(suggestContrastScale("中景")).toBe("特写");
  });

  it("未知景别回落特写，不崩", () => {
    expect(suggestContrastScale("俯拍")).toBe("特写");
  });
});
