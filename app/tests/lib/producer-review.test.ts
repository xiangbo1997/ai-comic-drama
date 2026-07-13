import { describe, it, expect } from "vitest";
import {
  normalizeProducerReview,
  isProducerReviewComplete,
  countProducerReviewProgress,
} from "@/lib/producer-review";

describe("normalizeProducerReview", () => {
  it("createdByProducer 非严格 true → undefined（不污染常规项目）", () => {
    expect(normalizeProducerReview(undefined)).toBeUndefined();
    expect(normalizeProducerReview(null)).toBeUndefined();
    expect(normalizeProducerReview({})).toBeUndefined();
    expect(
      normalizeProducerReview({ createdByProducer: "yes" })
    ).toBeUndefined();
    expect(normalizeProducerReview({ createdByProducer: 1 })).toBeUndefined();
  });

  it("合法输入 → 归一化结构", () => {
    const out = normalizeProducerReview({
      createdByProducer: true,
      confirmed: {
        worldview: true,
        script: false,
        characters: ["c1", "c2"],
        scenes: ["s1"],
      },
    });
    expect(out).toEqual({
      createdByProducer: true,
      confirmed: {
        worldview: true,
        script: false,
        characters: ["c1", "c2"],
        scenes: ["s1"],
      },
    });
  });

  it("confirmed 缺省 / 非对象 → 全 false + 空数组", () => {
    expect(normalizeProducerReview({ createdByProducer: true })).toEqual({
      createdByProducer: true,
      confirmed: {
        worldview: false,
        script: false,
        characters: [],
        scenes: [],
      },
    });
  });

  it("布尔字段只接受严格 true", () => {
    const out = normalizeProducerReview({
      createdByProducer: true,
      confirmed: { worldview: "true", script: 1 },
    });
    expect(out?.confirmed.worldview).toBe(false);
    expect(out?.confirmed.script).toBe(false);
  });

  it("id 数组去重 + 过滤非串 + 截长", () => {
    const longId = "x".repeat(200);
    const out = normalizeProducerReview({
      createdByProducer: true,
      confirmed: {
        characters: ["c1", "c1", 42, null, longId],
        scenes: [],
      },
    });
    expect(out?.confirmed.characters).toEqual(["c1", longId.slice(0, 64)]);
  });

  it("id 数组超上限被截断（scenes 上限 500）", () => {
    const many = Array.from({ length: 600 }, (_, i) => `s${i}`);
    const out = normalizeProducerReview({
      createdByProducer: true,
      confirmed: { scenes: many },
    });
    expect(out?.confirmed.scenes.length).toBe(500);
  });
});

describe("isProducerReviewComplete", () => {
  const complete = {
    createdByProducer: true as const,
    confirmed: {
      worldview: true,
      script: true,
      characters: ["c1", "c2"],
      scenes: ["s1", "s2"],
    },
  };

  it("全部确认 → true", () => {
    expect(isProducerReviewComplete(complete, ["c1", "c2"], ["s1", "s2"])).toBe(
      true
    );
  });

  it("世界观或脚本未确认 → false", () => {
    expect(
      isProducerReviewComplete(
        { ...complete, confirmed: { ...complete.confirmed, worldview: false } },
        ["c1", "c2"],
        ["s1", "s2"]
      )
    ).toBe(false);
  });

  it("有角色未确认 → false", () => {
    expect(
      isProducerReviewComplete(complete, ["c1", "c2", "c3"], ["s1", "s2"])
    ).toBe(false);
  });

  it("review 为空 → false", () => {
    expect(isProducerReviewComplete(null, [], [])).toBe(false);
  });

  it("无角色无分镜但两分区已确认 → true", () => {
    expect(isProducerReviewComplete(complete, [], [])).toBe(true);
  });
});

describe("countProducerReviewProgress", () => {
  it("统计已确认 / 总项（世界观+脚本各 1，角色/分镜逐个）", () => {
    const review = {
      createdByProducer: true as const,
      confirmed: {
        worldview: true,
        script: false,
        characters: ["c1"],
        scenes: [],
      },
    };
    // total = 2 + 2角色 + 1分镜 = 5；confirmed = 世界观1 + c1命中1 = 2
    expect(countProducerReviewProgress(review, ["c1", "c2"], ["s1"])).toEqual({
      confirmed: 2,
      total: 5,
    });
  });

  it("review 为空 → 0 / total", () => {
    expect(countProducerReviewProgress(null, ["c1"], ["s1"])).toEqual({
      confirmed: 0,
      total: 4,
    });
  });

  it("已确认但已不存在的 id 不计数（只数当前项）", () => {
    const review = {
      createdByProducer: true as const,
      confirmed: {
        worldview: true,
        script: true,
        characters: ["deleted"],
        scenes: [],
      },
    };
    // characters=["deleted"] 不在当前 ["c1"] 里 → 不计；confirmed = 2
    expect(countProducerReviewProgress(review, ["c1"], [])).toEqual({
      confirmed: 2,
      total: 3,
    });
  });
});
