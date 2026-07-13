/**
 * 多候选抽卡 · 择优纯逻辑（批次 2 · 1.4）
 *
 * 与副作用（生成 / 上传 / 打分 / DB）解耦的纯函数，供服务端编排调用并单测覆盖：
 * - 档位 count 合法化（只允许 1 / 2 / 4）
 * - 成功候选中挑「推荐」张（VLM 分数最高；无分数回落第一张）
 * - similarityScores 合并（保留人脸校验等既有键，绝不整字段覆盖）
 *
 * 铁律：这些函数不做 I/O、不抛副作用错误，纯数据进纯数据出，便于测试。
 */

/** 合法档位：1 张（零回归）/ 2 张 / 4 张 */
export const ALLOWED_CANDIDATE_COUNTS = [1, 2, 4] as const;
export type CandidateCount = (typeof ALLOWED_CANDIDATE_COUNTS)[number];

/**
 * 合法化档位：仅放行 1 / 2 / 4，其余（含 undefined / 非法值）回落 1。
 * count=1 时全链路行为与单发生成完全一致（零回归的基石）。
 */
export function normalizeCandidateCount(raw: unknown): CandidateCount {
  return (ALLOWED_CANDIDATE_COUNTS as readonly number[]).includes(raw as number)
    ? (raw as CandidateCount)
    : 1;
}

/** VLM 打分结果（单张候选） */
export interface CandidateScore {
  /** 0–100 综合分；无视觉能力 / 打分失败时为 null（降级不阻断） */
  vlmScore: number | null;
  /** 打分理由（模型反馈）；无则 null */
  vlmReason: string | null;
}

/**
 * 从成功候选中挑选推荐索引：
 * - 有任一 VLM 分数：取分数最高者（并列取靠前的，稳定）；
 * - 全部无分数（视觉不可用 / 打分全失败）：回落第一张（index 0）。
 *
 * @param scores 与成功候选一一对应的分数数组（顺序即候选顺序）
 * @returns 推荐候选的下标；空数组返回 -1
 */
export function pickRecommendedIndex(scores: CandidateScore[]): number {
  if (scores.length === 0) return -1;

  let bestIndex = 0;
  let bestScore = -Infinity;
  let hasAnyScore = false;

  for (let i = 0; i < scores.length; i++) {
    const s = scores[i].vlmScore;
    if (typeof s === "number") {
      hasAnyScore = true;
      // 严格大于才更新 → 并列时保留靠前候选（稳定选择）
      if (s > bestScore) {
        bestScore = s;
        bestIndex = i;
      }
    }
  }

  // 全部无分数：回落第一张
  return hasAnyScore ? bestIndex : 0;
}

/**
 * 合并 VLM 分数到既有 similarityScores（人脸校验等可能已写入该字段）。
 *
 * 铁律：展开合并既有键，只覆盖 / 追加 vlmScore、vlmReason 两键，绝不丢弃他人数据。
 * 无分数（null）时不写入对应键（保持字段干净，前端「有值才显示」逻辑据此判断）。
 *
 * @param existing 既有 similarityScores（Json 读出，可能是任意形状 / null / 非对象）
 * @param score VLM 分数
 * @returns 合并后的普通对象（可直接写回 Prisma Json 字段）
 */
export function mergeSimilarityScores(
  existing: unknown,
  score: CandidateScore
): Record<string, unknown> {
  // 类型收窄：仅当 existing 是普通对象时才展开，否则视为空基底（安全）
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if (typeof score.vlmScore === "number") {
    base.vlmScore = score.vlmScore;
  }
  if (typeof score.vlmReason === "string" && score.vlmReason.trim()) {
    base.vlmReason = score.vlmReason.trim();
  }
  return base;
}
