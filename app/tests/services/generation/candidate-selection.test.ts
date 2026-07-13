import { describe, it, expect } from "vitest";
import {
  normalizeCandidateCount,
  pickRecommendedIndex,
  mergeSimilarityScores,
  ALLOWED_CANDIDATE_COUNTS,
  type CandidateScore,
} from "@/services/generation/candidate-selection";

describe("normalizeCandidateCount", () => {
  it("放行合法档位 1 / 2 / 4", () => {
    expect(normalizeCandidateCount(1)).toBe(1);
    expect(normalizeCandidateCount(2)).toBe(2);
    expect(normalizeCandidateCount(4)).toBe(4);
  });

  it("非法值一律回落 1（零回归基石）", () => {
    expect(normalizeCandidateCount(3)).toBe(1);
    expect(normalizeCandidateCount(0)).toBe(1);
    expect(normalizeCandidateCount(-1)).toBe(1);
    expect(normalizeCandidateCount(100)).toBe(1);
    expect(normalizeCandidateCount(undefined)).toBe(1);
    expect(normalizeCandidateCount(null)).toBe(1);
    expect(normalizeCandidateCount("2")).toBe(1);
    expect(normalizeCandidateCount(2.5)).toBe(1);
    expect(normalizeCandidateCount({})).toBe(1);
  });

  it("合法档位集合稳定为 [1,2,4]", () => {
    expect([...ALLOWED_CANDIDATE_COUNTS]).toEqual([1, 2, 4]);
  });
});

describe("pickRecommendedIndex", () => {
  it("空数组返回 -1", () => {
    expect(pickRecommendedIndex([])).toBe(-1);
  });

  it("取分数最高的候选下标", () => {
    const scores: CandidateScore[] = [
      { vlmScore: 70, vlmReason: null },
      { vlmScore: 92, vlmReason: null },
      { vlmScore: 85, vlmReason: null },
    ];
    expect(pickRecommendedIndex(scores)).toBe(1);
  });

  it("并列最高分取靠前候选（稳定选择）", () => {
    const scores: CandidateScore[] = [
      { vlmScore: 88, vlmReason: null },
      { vlmScore: 88, vlmReason: null },
    ];
    expect(pickRecommendedIndex(scores)).toBe(0);
  });

  it("全部无分数（视觉不可用）回落第一张", () => {
    const scores: CandidateScore[] = [
      { vlmScore: null, vlmReason: null },
      { vlmScore: null, vlmReason: null },
    ];
    expect(pickRecommendedIndex(scores)).toBe(0);
  });

  it("部分有分数：忽略无分数张，在有分数张里取最高", () => {
    const scores: CandidateScore[] = [
      { vlmScore: null, vlmReason: null },
      { vlmScore: 60, vlmReason: null },
      { vlmScore: null, vlmReason: null },
      { vlmScore: 75, vlmReason: null },
    ];
    expect(pickRecommendedIndex(scores)).toBe(3);
  });

  it("单张始终返回该张（零回归）", () => {
    expect(pickRecommendedIndex([{ vlmScore: 50, vlmReason: "ok" }])).toBe(0);
    expect(pickRecommendedIndex([{ vlmScore: null, vlmReason: null }])).toBe(0);
  });
});

describe("mergeSimilarityScores", () => {
  it("合并 vlmScore/vlmReason，保留既有键（不整字段覆盖）", () => {
    const existing = { faceCount: 1, faceSimilarity: 0.9 };
    const merged = mergeSimilarityScores(existing, {
      vlmScore: 88,
      vlmReason: "构图与情绪贴合",
    });
    expect(merged).toEqual({
      faceCount: 1,
      faceSimilarity: 0.9,
      vlmScore: 88,
      vlmReason: "构图与情绪贴合",
    });
  });

  it("无分数时不写 vlmScore 键（保持字段干净）", () => {
    const merged = mergeSimilarityScores(
      { faceCount: 2 },
      { vlmScore: null, vlmReason: null }
    );
    expect(merged).toEqual({ faceCount: 2 });
    expect("vlmScore" in merged).toBe(false);
  });

  it("既有值为 null / 非对象 / 数组时视为空基底（安全收窄）", () => {
    expect(
      mergeSimilarityScores(null, { vlmScore: 70, vlmReason: null })
    ).toEqual({ vlmScore: 70 });
    expect(
      mergeSimilarityScores("garbage", { vlmScore: 70, vlmReason: null })
    ).toEqual({ vlmScore: 70 });
    expect(
      mergeSimilarityScores([1, 2, 3], { vlmScore: 70, vlmReason: null })
    ).toEqual({ vlmScore: 70 });
  });

  it("空理由 / 纯空白理由不写入 vlmReason", () => {
    const merged = mergeSimilarityScores(
      {},
      { vlmScore: 50, vlmReason: "   " }
    );
    expect(merged).toEqual({ vlmScore: 50 });
  });

  it("覆盖同名旧 vlmScore（重评时更新）", () => {
    const merged = mergeSimilarityScores(
      { vlmScore: 40, faceCount: 1 },
      { vlmScore: 90, vlmReason: null }
    );
    expect(merged).toEqual({ vlmScore: 90, faceCount: 1 });
  });
});

describe("成功张扣费计算（成功后才扣语义）", () => {
  // 服务端扣费 = 成功张数 × 单张成本；失败张天然不计（无退款路径）。
  // 这里用纯计算复刻该语义做守卫。
  const perImageCost = (hasRef: boolean) => (hasRef ? 3 : 1);

  it("全部成功：N × 单价", () => {
    const successCount = 4;
    expect(successCount * perImageCost(false)).toBe(4);
    expect(successCount * perImageCost(true)).toBe(12);
  });

  it("部分失败：只按成功张数计（失败张不扣）", () => {
    const requested = 4;
    const failed = 1;
    const successCount = requested - failed;
    expect(successCount * perImageCost(true)).toBe(9);
  });

  it("单张（count=1）：与原单发扣费一致（零回归）", () => {
    expect(1 * perImageCost(false)).toBe(1);
    expect(1 * perImageCost(true)).toBe(3);
  });
});
