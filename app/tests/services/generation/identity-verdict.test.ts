import { describe, it, expect } from "vitest";
import {
  aggregateIdentityVerdict,
  mapGradeToAction,
  IDENTITY_THRESHOLDS,
  ALL_IDENTITY_ATTRIBUTES,
  type AttributeFinding,
  type AttributeJudgement,
  type IdentityAttribute,
} from "@/services/generation/identity-verdict";
import { buildIdentityCheckPrompt } from "@/lib/prompts/identity-check";

/** 便捷构造：默认 6 维全 match，按 overrides 覆盖个别维度 */
function findings(
  overrides: Partial<Record<IdentityAttribute, AttributeJudgement>> = {}
): AttributeFinding[] {
  return ALL_IDENTITY_ATTRIBUTES.map((attribute) => ({
    attribute,
    judgement: overrides[attribute] ?? "match",
  }));
}

describe("aggregateIdentityVerdict() — 非对称判据", () => {
  it("6 维全 match → PASS，满分", () => {
    const v = aggregateIdentityVerdict({ findings: findings() });
    expect(v.grade).toBe("PASS");
    expect(v.score).toBe(1);
    expect(v.violations).toHaveLength(0);
  });

  // A²RD 核心：身份类 mismatch = 明显换人，不可救
  it("face mismatch → 直接 FAIL（无论其他维度多好）", () => {
    const v = aggregateIdentityVerdict({
      findings: findings({ face: "mismatch" }),
    });
    expect(v.grade).toBe("FAIL");
    expect(v.violations.map((x) => x.attribute)).toEqual(["face"]);
  });

  it("bodyType mismatch → 直接 FAIL", () => {
    const v = aggregateIdentityVerdict({
      findings: findings({ bodyType: "mismatch" }),
    });
    expect(v.grade).toBe("FAIL");
  });

  // A²RD 另一半：轻微差异不算违规，不该触发重试
  it("全维度 minor（脏污/配饰/光照）→ 仍 PASS，零违规", () => {
    const v = aggregateIdentityVerdict({
      findings: findings({
        face: "minor",
        bodyType: "minor",
        hairstyle: "minor",
        hairColor: "minor",
        outfit: "minor",
        accessories: "minor",
      }),
    });
    expect(v.grade).toBe("PASS");
    expect(v.violations).toHaveLength(0);
    expect(v.score).toBeCloseTo(0.85, 3);
  });

  it("单个外观类 mismatch（配饰）只降分不致命", () => {
    const v = aggregateIdentityVerdict({
      findings: findings({ accessories: "mismatch" }),
    });
    expect(v.grade).toBe("PASS"); // 0.92 ≥ 0.8
    expect(v.violations.map((x) => x.attribute)).toEqual(["accessories"]);
  });

  it("多个外观类 mismatch 累积后落到 BORDERLINE", () => {
    const v = aggregateIdentityVerdict({
      findings: findings({
        hairstyle: "mismatch",
        hairColor: "mismatch",
        outfit: "mismatch",
      }),
    });
    expect(v.grade).toBe("BORDERLINE");
    expect(v.score).toBeLessThan(IDENTITY_THRESHOLDS.pass);
    expect(v.score).toBeGreaterThanOrEqual(IDENTITY_THRESHOLDS.borderline);
  });

  it("外观类全 mismatch → 掉到 FAIL", () => {
    const v = aggregateIdentityVerdict({
      findings: findings({
        hairstyle: "mismatch",
        hairColor: "mismatch",
        outfit: "mismatch",
        accessories: "mismatch",
      }),
    });
    expect(v.grade).toBe("FAIL");
    expect(v.score).toBeLessThan(IDENTITY_THRESHOLDS.borderline);
  });

  // 剧情意图豁免：防过度纠正
  it("剧情声明换装 → outfit mismatch 被豁免，回到 PASS", () => {
    const v = aggregateIdentityVerdict({
      findings: findings({ outfit: "mismatch", accessories: "mismatch" }),
      intendedChanges: ["outfit", "accessories"],
    });
    expect(v.grade).toBe("PASS");
    expect(v.score).toBe(1);
    expect(v.exempted).toEqual(["outfit", "accessories"]);
    expect(v.violations).toHaveLength(0);
  });

  it("剧情豁免不适用于身份类：声明 face 也不豁免（不许换人）", () => {
    const v = aggregateIdentityVerdict({
      findings: findings({ face: "mismatch" }),
      intendedChanges: ["face"],
    });
    expect(v.grade).toBe("FAIL");
    expect(v.exempted).toHaveLength(0);
  });

  it("豁免维度判定为 match 时不计入 exempted", () => {
    const v = aggregateIdentityVerdict({
      findings: findings(),
      intendedChanges: ["outfit"],
    });
    expect(v.exempted).toHaveLength(0);
  });

  // 诚实报告：无有效表态不能伪装成 PASS
  it("findings 为空 → BORDERLINE + score 0（不伪装成通过）", () => {
    const v = aggregateIdentityVerdict({ findings: [] });
    expect(v.grade).toBe("BORDERLINE");
    expect(v.score).toBe(0);
  });

  it("未知维度被忽略；全是未知等价于空", () => {
    const v = aggregateIdentityVerdict({
      findings: [
        { attribute: "蜜汁" as IdentityAttribute, judgement: "mismatch" },
      ],
    });
    expect(v.grade).toBe("BORDERLINE");
    expect(v.score).toBe(0);
  });

  it("部分维度缺失时按已覆盖维度归一化（少答不等于低分）", () => {
    const v = aggregateIdentityVerdict({
      findings: [
        { attribute: "face", judgement: "match" },
        { attribute: "bodyType", judgement: "match" },
      ],
    });
    expect(v.grade).toBe("PASS");
    expect(v.score).toBe(1);
  });

  it("同维度重复上报取最严格的一条", () => {
    const v = aggregateIdentityVerdict({
      findings: [
        { attribute: "face", judgement: "match" },
        { attribute: "face", judgement: "mismatch" },
      ],
    });
    expect(v.grade).toBe("FAIL");
  });
});

describe("mapGradeToAction() — 三档映射 + 重试上界", () => {
  it("PASS → accept（有无余量都一样）", () => {
    expect(mapGradeToAction("PASS", 3)).toBe("accept");
    expect(mapGradeToAction("PASS", 0)).toBe("accept");
  });

  it("BORDERLINE + 有余量 → retry", () => {
    expect(mapGradeToAction("BORDERLINE", 1)).toBe("retry");
  });

  it("FAIL + 有余量 → discard", () => {
    expect(mapGradeToAction("FAIL", 2)).toBe("discard");
  });

  // 成本护栏：重试必须有上界，不能无限烧积分
  it("余量用尽 → 一律 accept（不硬阻断出图）", () => {
    expect(mapGradeToAction("BORDERLINE", 0)).toBe("accept");
    expect(mapGradeToAction("FAIL", 0)).toBe("accept");
    expect(mapGradeToAction("FAIL", -1)).toBe("accept");
  });
});

describe("buildIdentityCheckPrompt()", () => {
  it("无换装标注时声明服装应与参考一致", () => {
    const p = buildIdentityCheckPrompt({ characterName: "林萧" });
    expect(p).toContain("林萧");
    expect(p).toContain("本镜无换装标注");
  });

  it("有换装标注时写入剧情设定块并要求判 match", () => {
    const p = buildIdentityCheckPrompt({
      characterName: "林萧",
      outfitNote: "白色婚纱",
      sceneDescription: "林萧身穿婚纱走进教堂",
    });
    expect(p).toContain("剧情设定");
    expect(p).toContain("白色婚纱");
    expect(p).toContain("判 match");
  });

  it("长描述被截断，防 prompt 膨胀", () => {
    const p = buildIdentityCheckPrompt({
      characterName: "林萧",
      sceneDescription: "描".repeat(500),
    });
    expect(p).not.toContain("描".repeat(200));
  });

  it("景别写入 prompt（远景细节差异应判 minor）", () => {
    const p = buildIdentityCheckPrompt({
      characterName: "林萧",
      shotType: "中景",
    });
    expect(p).toContain("中景");
  });
});
