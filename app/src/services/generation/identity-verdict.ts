/**
 * 属性级身份一致性判据（纯逻辑，无网络 / 无 prisma，可完整单测）
 *
 * 为什么不问「这张图保持了身份吗」：
 * 笼统提问只会换回笼统回答，细粒度不一致（换了发色、配饰消失、脸型走形）
 * 全被一句「看起来是同一个人」盖过去。所以把身份拆成 6 个可独立判定的属性维度，
 * 逐项让 VLM 表态，再由本文件的纯函数把属性判定聚合成三档结论。
 *
 * 非对称判据（A²RD）：
 * 「明显换人 / 脸型体型明显不同 / 物种改变」才算违规；轻微服装脏污、配饰差异、
 * 光照色温变化【不算】。两类差异不对称对待 —— 否则阈值一紧，重试率与积分消耗
 * 直接爆表，而画面其实是可用的。实现上体现为：
 *   - 身份类维度（face / bodyType）任一 FAIL ⇒ 整体 FAIL（不可救，换人了）
 *   - 外观类维度（outfit / hairstyle / hairColor / accessories）只降档不致命
 *
 * 剧情意图：上游会把本镜换装标注（characterOutfits）与画面描述一并喂给 VLM，
 * 并在聚合层把「已声明换装」的外观维度直接豁免 —— 剧情就是要战损/婚纱时，
 * 判成不一致属于过度纠正。
 */

/** 属性维度（身份类 + 外观类） */
export type IdentityAttribute =
  | "face"
  | "bodyType"
  | "hairstyle"
  | "hairColor"
  | "outfit"
  | "accessories";

/** 身份类维度：决定「是不是同一个人」，FAIL 即整体 FAIL */
export const IDENTITY_CRITICAL_ATTRIBUTES: readonly IdentityAttribute[] = [
  "face",
  "bodyType",
];

/** 外观类维度：剧情可合理变化，只降档不致命 */
export const APPEARANCE_ATTRIBUTES: readonly IdentityAttribute[] = [
  "hairstyle",
  "hairColor",
  "outfit",
  "accessories",
];

export const ALL_IDENTITY_ATTRIBUTES: readonly IdentityAttribute[] = [
  ...IDENTITY_CRITICAL_ATTRIBUTES,
  ...APPEARANCE_ATTRIBUTES,
];

/** 单维度判定：match=一致，minor=轻微差异（非对称判据下不算违规），mismatch=明显不一致 */
export type AttributeJudgement = "match" | "minor" | "mismatch";

/** 三档结论 → 编排动作：accept / retry / discard */
export type IdentityGrade = "PASS" | "BORDERLINE" | "FAIL";

/** 单维度的 VLM 原始表态 */
export interface AttributeFinding {
  attribute: IdentityAttribute;
  judgement: AttributeJudgement;
  /** VLM 给的简短理由（≤40 字，用于反思/日志） */
  note?: string;
}

/** 聚合输入：VLM 的属性表态 + 剧情意图豁免 */
export interface VerdictInput {
  findings: AttributeFinding[];
  /**
   * 剧情已声明变化的维度（来自分镜 characterOutfits / 画面描述）。
   * 命中的维度即便 mismatch 也按 match 处理 —— 剧情要求的换装不是错误。
   */
  intendedChanges?: readonly IdentityAttribute[];
}

export interface IdentityVerdict {
  grade: IdentityGrade;
  /** 0-1 的聚合分数（供阈值比较 / 日志 / 历史最优保留） */
  score: number;
  /** 触发降档的维度（已扣除剧情豁免），供反思 prompt 与日志使用 */
  violations: AttributeFinding[];
  /** 因剧情意图被豁免的维度 */
  exempted: IdentityAttribute[];
}

/**
 * 维度权重：身份类远重于外观类（非对称判据的量化体现）。
 * 满分 1.0，按「命中维度权重 × 判定系数」求和后归一化。
 */
const ATTRIBUTE_WEIGHT: Record<IdentityAttribute, number> = {
  face: 0.35,
  bodyType: 0.2,
  hairstyle: 0.13,
  hairColor: 0.12,
  outfit: 0.12,
  accessories: 0.08,
};

/** 判定系数：minor 不按违规记，仅轻微扣分（非对称判据） */
const JUDGEMENT_FACTOR: Record<AttributeJudgement, number> = {
  match: 1,
  minor: 0.85,
  mismatch: 0,
};

/** 三档阈值（作用于聚合分数；身份类 mismatch 另有硬规则短路） */
export const IDENTITY_THRESHOLDS = {
  /** ≥ pass 且无身份类 mismatch ⇒ PASS */
  pass: 0.8,
  /** ≥ borderline 但 < pass ⇒ BORDERLINE（二次投票 / 可重试） */
  borderline: 0.6,
} as const;

/**
 * 把属性表态聚合为三档结论。纯函数。
 *
 * 规则（优先级自上而下）：
 * 1. 剧情豁免：intendedChanges 命中的维度按 match 处理。
 * 2. 身份硬规则：face / bodyType 任一 mismatch ⇒ FAIL（明显换人，重试也救不回这张）。
 * 3. 其余按加权分数落档：≥0.8 PASS，≥0.6 BORDERLINE，否则 FAIL。
 * 4. 无任何有效表态（findings 为空）⇒ BORDERLINE，score 0，交给调用方按「无法校验」处理，
 *    绝不伪装成 PASS。
 */
export function aggregateIdentityVerdict(input: VerdictInput): IdentityVerdict {
  const intended = new Set(input.intendedChanges ?? []);
  const exempted: IdentityAttribute[] = [];

  // 同一维度重复上报时以最严格的一条为准，避免 VLM 重复输出稀释判定
  const bySeverity: Map<IdentityAttribute, AttributeFinding> = new Map();
  for (const f of input.findings) {
    if (!ALL_IDENTITY_ATTRIBUTES.includes(f.attribute)) continue;
    const prev = bySeverity.get(f.attribute);
    if (!prev || severityRank(f.judgement) > severityRank(prev.judgement)) {
      bySeverity.set(f.attribute, f);
    }
  }

  if (bySeverity.size === 0) {
    return { grade: "BORDERLINE", score: 0, violations: [], exempted: [] };
  }

  const violations: AttributeFinding[] = [];
  let weighted = 0;
  let totalWeight = 0;

  for (const [attribute, finding] of bySeverity) {
    const weight = ATTRIBUTE_WEIGHT[attribute];
    totalWeight += weight;

    // 剧情豁免：只豁免外观类；身份类（脸/体型）无论剧情如何都不该换人
    const isExempt =
      intended.has(attribute) &&
      APPEARANCE_ATTRIBUTES.includes(attribute) &&
      finding.judgement !== "match";
    if (isExempt) {
      exempted.push(attribute);
      weighted += weight * JUDGEMENT_FACTOR.match;
      continue;
    }

    weighted += weight * JUDGEMENT_FACTOR[finding.judgement];
    // minor 不计违规（非对称判据：轻微差异不是错）
    if (finding.judgement === "mismatch") violations.push(finding);
  }

  // 只覆盖部分维度时按已覆盖维度归一化，避免「VLM 少答几项」被当成低分
  const score = totalWeight > 0 ? weighted / totalWeight : 0;

  const identityBroken = violations.some((v) =>
    IDENTITY_CRITICAL_ATTRIBUTES.includes(v.attribute)
  );
  const grade: IdentityGrade = identityBroken
    ? "FAIL"
    : score >= IDENTITY_THRESHOLDS.pass
      ? "PASS"
      : score >= IDENTITY_THRESHOLDS.borderline
        ? "BORDERLINE"
        : "FAIL";

  return { grade, score: round3(score), violations, exempted };
}

/** 严格程度排序：mismatch > minor > match */
function severityRank(j: AttributeJudgement): number {
  return j === "mismatch" ? 2 : j === "minor" ? 1 : 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 三档 → 编排动作 */
export type IdentityAction = "accept" | "retry" | "discard";

/**
 * 三档结论映射为编排动作。纯函数。
 *
 * - PASS      → accept（直接用）
 * - BORDERLINE→ 还有重试余量时 retry；用尽则 accept（不硬阻断出图，项目设计哲学）
 * - FAIL      → 还有重试余量时 discard（丢弃重生成）；用尽则 accept 保底返回
 *
 * 重试必须有上界：FAIL 也不无限重试，否则烧积分（编排器 maxRetries 即上界）。
 */
export function mapGradeToAction(
  grade: IdentityGrade,
  retriesRemaining: number
): IdentityAction {
  if (grade === "PASS") return "accept";
  if (retriesRemaining <= 0) return "accept";
  return grade === "FAIL" ? "discard" : "retry";
}
