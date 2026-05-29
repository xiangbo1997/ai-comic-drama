/**
 * CharacterBibleObserver — 角色圣经质量评审 (P3.5 闭环2)
 *
 * 纯函数评审（不调 LLM，零成本零延迟）：检查角色圣经是否质量达标，
 * 不达标的话由闭环触发 CharacterBibleAgent 重生成。
 *
 * 评审维度（加权）：
 * - coverage (40%): canonicalPrompt 是否对每个角色都非空
 * - density  (30%): canonicalPrompt 信息密度（长度），过短说明描述不足
 * - structure(30%): appearance 结构化字段填充率（非占位词）
 */

import type { CharacterBible, ObserverVerdict } from "./types";

const PLACEHOLDER_TOKENS = [
  "unknown",
  "unnamed",
  "unspecified",
  "n/a",
  "未知",
  "待定",
];

function isPlaceholder(value: string | undefined | null): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (!v) return true;
  return PLACEHOLDER_TOKENS.some((t) => v === t || v.includes(t));
}

/**
 * 评审角色圣经质量。纯函数，无副作用。
 */
export function reviewCharacterBible(bible: CharacterBible): ObserverVerdict {
  const chars = bible.characters;
  if (chars.length === 0) {
    return {
      pass: false,
      score: {
        overall: 0,
        dimensions: { coverage: 0, density: 0, structure: 0 },
        pass: false,
        feedback: "角色圣经为空",
      },
      retryable: true,
      suggestions: ["重新解析角色，至少生成一个角色的标准外貌"],
    };
  }

  // coverage：canonicalPrompt 非空比例
  const withPrompt = chars.filter((c) => !isPlaceholder(c.canonicalPrompt));
  const coverage = (withPrompt.length / chars.length) * 100;

  // density：canonicalPrompt 平均长度（>=30 视为充分，线性映射到 0-100）
  const avgLen =
    chars.reduce((sum, c) => sum + (c.canonicalPrompt?.length ?? 0), 0) /
    chars.length;
  const density = Math.min(100, (avgLen / 30) * 100);

  // structure：appearance 关键字段非占位的填充率
  const structureScores = chars.map((c) => {
    const a = c.appearance;
    if (!a) return 0;
    const fields = [
      a.hairStyle,
      a.hairColor,
      a.faceShape,
      a.eyeColor,
      a.bodyType,
      a.clothing,
    ];
    const filled = fields.filter((f) => !isPlaceholder(f)).length;
    return (filled / fields.length) * 100;
  });
  const structure =
    structureScores.reduce((a, b) => a + b, 0) / structureScores.length;

  const overall = Math.round(coverage * 0.4 + density * 0.3 + structure * 0.3);

  const suggestions: string[] = [];
  const lowCoverage = chars.filter((c) => isPlaceholder(c.canonicalPrompt));
  if (lowCoverage.length > 0) {
    suggestions.push(
      `以下角色缺少标准外貌提示词：${lowCoverage.map((c) => c.name).join("、")}`
    );
  }
  if (density < 70) {
    suggestions.push("角色外貌描述偏简略，建议补充发型/服饰/体型等细节");
  }
  if (structure < 70) {
    suggestions.push("角色结构化外貌字段填充不足，存在占位值");
  }

  return {
    pass: overall >= 70,
    score: {
      overall,
      dimensions: {
        coverage: Math.round(coverage),
        density: Math.round(density),
        structure: Math.round(structure),
      },
      pass: overall >= 70,
      feedback:
        overall >= 70
          ? `角色圣经质量达标（${overall}/100）`
          : `角色圣经质量不足（${overall}/100）`,
    },
    retryable: true,
    suggestions,
  };
}
