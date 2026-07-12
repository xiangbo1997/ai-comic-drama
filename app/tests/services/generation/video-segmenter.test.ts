import { describe, it, expect } from "vitest";
import {
  planVideoSegments,
  estimateVideoCost,
  nearestVideoDuration,
  clampSceneDuration,
} from "@/services/generation/video-segmenter";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import type { VideoModelCapability } from "@/services/ai/video-capabilities";

// Veo 类：忽略 duration，固定 8s 原生片段，支持 FL，最多 6 段
const veoCap: VideoModelCapability = getVideoModelCapability("flow2api");
// 档位类：本地字面量 fixture（纯逻辑测试与能力表解耦——真实 provider 档位
// 的正确性由 video-capabilities.test.ts 单独把关）
const tierCap: VideoModelCapability = {
  nativeClipSeconds: 15,
  requestableDurations: [5, 10, 15],
  acceptsDurationParam: true,
  supportsFirstLastFrame: false,
  maxChainSegments: 6,
};
// runway/fal 真实档位（仅 5/10）：验证 15s 请求诚实拆两段而非静默压 10s
const runwayCap: VideoModelCapability = getVideoModelCapability("runway");

describe("clampSceneDuration — 钳制到 1–60 整数", () => {
  it("正常值原样返回", () => {
    expect(clampSceneDuration(20)).toBe(20);
  });
  it("下越界钳到 1", () => {
    expect(clampSceneDuration(0)).toBe(1);
    expect(clampSceneDuration(-5)).toBe(1);
  });
  it("上越界钳到 60", () => {
    expect(clampSceneDuration(120)).toBe(60);
  });
  it("小数四舍五入", () => {
    expect(clampSceneDuration(7.6)).toBe(8);
  });
  it("非数值回落 1", () => {
    expect(clampSceneDuration(NaN)).toBe(1);
    expect(clampSceneDuration("abc")).toBe(1);
  });
});

describe("nearestVideoDuration — 真-nearest（非阈值式）", () => {
  it("默认档位 5/10/15", () => {
    expect(nearestVideoDuration(3)).toBe(5);
    expect(nearestVideoDuration(7)).toBe(5); // |5-7|=2 < |10-7|=3
    expect(nearestVideoDuration(8)).toBe(10); // |10-8|=2 < |5-8|=3
    expect(nearestVideoDuration(13)).toBe(15);
  });
  it("缺省/异常回落 5", () => {
    expect(nearestVideoDuration(undefined)).toBe(5);
    expect(nearestVideoDuration(0)).toBe(5);
  });
  it("自定义档位", () => {
    expect(nearestVideoDuration(7, [5, 10])).toBe(5);
    expect(nearestVideoDuration(9, [5, 10])).toBe(10);
  });
  it("空档位回落 5", () => {
    expect(nearestVideoDuration(9, [])).toBe(5);
  });
});

describe("planVideoSegments — Veo（8s 原生、忽略 duration）", () => {
  it("3s → 1 段（≤ 单段能力，零回归）", () => {
    const plan = planVideoSegments(3, veoCap);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].requestDuration).toBeUndefined();
    expect(plan.segments[0].targetSeconds).toBe(8);
  });
  it("8s → 1 段", () => {
    const plan = planVideoSegments(8, veoCap);
    expect(plan.segments).toHaveLength(1);
  });
  it("12s → 2 段（round(12/8)=2）", () => {
    const plan = planVideoSegments(12, veoCap);
    expect(plan.segments).toHaveLength(2);
    expect(plan.estimatedTotalSeconds).toBe(16);
  });
  it("20s → 3 段（round(20/8)=3）", () => {
    const plan = planVideoSegments(20, veoCap);
    expect(plan.segments).toHaveLength(3);
  });
  it("60s → 6 段（round(60/8)=8 被 maxChainSegments 钳到 6）", () => {
    const plan = planVideoSegments(60, veoCap);
    expect(plan.segments).toHaveLength(6);
    // 所有段都不带 requestDuration（Veo 忽略请求时长）
    expect(plan.segments.every((s) => s.requestDuration === undefined)).toBe(
      true
    );
  });
  it("段序号从 0 递增", () => {
    const plan = planVideoSegments(20, veoCap);
    expect(plan.segments.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});

describe("planVideoSegments — 档位类（5/10/15、接受 duration）", () => {
  it("3s → 1 段 [5]（就近单档）", () => {
    const plan = planVideoSegments(3, tierCap);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].requestDuration).toBe(5);
  });
  it("7s → 1 段 [5]（真-nearest：|5-7|=2 < |10-7|=3）", () => {
    const plan = planVideoSegments(7, tierCap);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].requestDuration).toBe(5);
  });
  it("8s → 1 段 [10]（真-nearest：|10-8|=2 < |5-8|=3）", () => {
    const plan = planVideoSegments(8, tierCap);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].requestDuration).toBe(10);
  });
  it("15s → 1 段 [15]（恰好单档上限，零回归）", () => {
    const plan = planVideoSegments(15, tierCap);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].requestDuration).toBe(15);
  });
  it("20s → 2 段 [15,5]（降序贪心）", () => {
    const plan = planVideoSegments(20, tierCap);
    expect(plan.segments.map((s) => s.requestDuration)).toEqual([15, 5]);
    expect(plan.estimatedTotalSeconds).toBe(20);
  });
  it("35s → 3 段 [15,15,5]", () => {
    const plan = planVideoSegments(35, tierCap);
    expect(plan.segments.map((s) => s.requestDuration)).toEqual([15, 15, 5]);
  });
  it("60s → 4 段 [15,15,15,15]", () => {
    const plan = planVideoSegments(60, tierCap);
    expect(plan.segments.map((s) => s.requestDuration)).toEqual([
      15, 15, 15, 15,
    ]);
    expect(plan.estimatedTotalSeconds).toBe(60);
  });
});

describe("planVideoSegments — runway/fal 真实档位（仅 5/10）", () => {
  it("10s → 1 段 [10]（单档上限，零回归）", () => {
    const plan = planVideoSegments(10, runwayCap);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].requestDuration).toBe(10);
  });
  it("15s → 2 段 [10,5]（诚实拆段而非静默压 10s）", () => {
    const plan = planVideoSegments(15, runwayCap);
    expect(plan.segments.map((s) => s.requestDuration)).toEqual([10, 5]);
    expect(plan.estimatedTotalSeconds).toBe(15);
  });
});

describe("estimateVideoCost — 成本 = 各段档位成本之和", () => {
  it("档位类 5s → 10 积分", () => {
    expect(estimateVideoCost(5, tierCap)).toBe(10);
  });
  it("档位类 20s → [15,5] = 30 + 10 = 40 积分", () => {
    expect(estimateVideoCost(20, tierCap)).toBe(40);
  });
  it("档位类 15s → 30 积分（单段，零回归成本）", () => {
    expect(estimateVideoCost(15, tierCap)).toBe(30);
  });
  it("Veo 单段（≤8s）→ 20 积分（按 10s 档计）", () => {
    expect(estimateVideoCost(5, veoCap)).toBe(20);
  });
  it("Veo 20s（3 段）→ 3 × 20 = 60 积分", () => {
    expect(estimateVideoCost(20, veoCap)).toBe(60);
  });
});

describe("退化保证 — 时长 ≤ 单段能力恰好 1 段", () => {
  it("档位类所有 ≤15s 都是 1 段", () => {
    for (const d of [1, 5, 7, 10, 12, 15]) {
      expect(planVideoSegments(d, tierCap).segments).toHaveLength(1);
    }
  });
  it("Veo 所有 ≤8s 都是 1 段", () => {
    for (const d of [1, 3, 5, 8]) {
      expect(planVideoSegments(d, veoCap).segments).toHaveLength(1);
    }
  });
});
