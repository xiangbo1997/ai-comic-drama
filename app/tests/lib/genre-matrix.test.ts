/**
 * 题材适配矩阵（lib/genre-matrix.ts）单测。
 *
 * 两类断言：
 *  ① 注册表自洽性——id 唯一、档位合法、风险档位必须有 caution、每条结论必须有来源。
 *     这是「数据纪律」的护栏：以后加题材忘了写来源或风险理由，这里就红。
 *  ② 纯函数契约——查表回落、风险提示解析、prompt 上下文块（含零回归的空值语义）。
 */

import { describe, it, expect } from "vitest";
import {
  GENRE_OPTIONS,
  GENRE_TIERS,
  GENRE_TIER_GROUPS,
  SERIALIZATION_ADVICE,
  buildFreeformGenreBlock,
  buildGenreContextBlock,
  buildGenreGuidanceBlock,
  getGenreById,
  getGenreTierMeta,
  resolveGenreAdvisory,
  resolveSerializationHint,
  type GenreTier,
} from "@/lib/genre-matrix";

/** 必须给出风险理由（caution）的档位：选到这些档要让用户看见为什么不推荐 */
const RISK_TIERS: readonly GenreTier[] = [
  "blue-ocean",
  "red-ocean",
  "not-advised",
  "avoid",
  "prohibited",
];

describe("GENRE_OPTIONS 注册表自洽性", () => {
  it("id 全局唯一（落 generationParams.genre 的稳定键）", () => {
    const ids = GENRE_OPTIONS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个题材的档位都在 GENRE_TIERS 里登记", () => {
    const declaredTiers = new Set(GENRE_TIERS.map((t) => t.tier));
    for (const genre of GENRE_OPTIONS) {
      expect(declaredTiers.has(genre.tier), `${genre.id} 档位未登记`).toBe(
        true
      );
    }
  });

  it("每条结论都带来源与置信度（数据纪律：禁止无出处的硬规则）", () => {
    for (const genre of GENRE_OPTIONS) {
      expect(genre.source.trim().length, `${genre.id} 缺来源`).toBeGreaterThan(
        0
      );
      expect(["high", "medium", "low"]).toContain(genre.confidence);
    }
  });

  it("每个题材都有数据依据与创作要点（UI 与 prompt 两侧都要有话可说）", () => {
    for (const genre of GENRE_OPTIONS) {
      expect(
        genre.rationale.trim().length,
        `${genre.id} 缺依据`
      ).toBeGreaterThan(0);
      expect(
        genre.craftNote.trim().length,
        `${genre.id} 缺创作要点`
      ).toBeGreaterThan(0);
    }
  });

  it("风险档位必须写明 caution（否则用户看不到为什么不推荐）", () => {
    for (const genre of GENRE_OPTIONS) {
      if (RISK_TIERS.includes(genre.tier)) {
        expect(
          genre.caution?.trim().length,
          `${genre.id} 缺风险理由`
        ).toBeTruthy();
      }
    }
  });

  it("推荐档位（首选/推荐）不带 caution（避免给正向选项挂警告）", () => {
    for (const genre of GENRE_OPTIONS) {
      if (genre.tier === "first-choice" || genre.tier === "recommended") {
        expect(genre.caution, `${genre.id} 不该有风险理由`).toBeUndefined();
      }
    }
  });

  it("覆盖调研给出的关键结论：异能是最大蓝海、解说漫剧被平台打压", () => {
    const yineng = getGenreById("yineng");
    expect(yineng?.tier).toBe("first-choice");
    expect(yineng?.rationale).toContain("193");

    const jieshuo = getGenreById("jieshuo");
    expect(jieshuo?.tier).toBe("prohibited");
    expect(jieshuo?.caution).toBeTruthy();
  });
});

describe("GENRE_TIER_GROUPS 分组派生", () => {
  it("分组顺序与 GENRE_TIERS 一致，且不含空分组", () => {
    const groupTiers = GENRE_TIER_GROUPS.map((g) => g.meta.tier);
    const expected = GENRE_TIERS.map((t) => t.tier).filter((tier) =>
      GENRE_OPTIONS.some((g) => g.tier === tier)
    );
    expect(groupTiers).toEqual(expected);
    for (const group of GENRE_TIER_GROUPS) {
      expect(group.options.length).toBeGreaterThan(0);
    }
  });

  it("分组覆盖全部题材，无遗漏无重复", () => {
    const grouped = GENRE_TIER_GROUPS.flatMap((g) =>
      g.options.map((o) => o.id)
    );
    expect(grouped.sort()).toEqual(GENRE_OPTIONS.map((g) => g.id).sort());
  });
});

describe("getGenreById / getGenreTierMeta 查表", () => {
  it("命中返回条目", () => {
    expect(getGenreById("xuanhuan")?.label).toContain("玄幻");
  });

  it("未知 id / 空值返回 null（题材是可选项，不设默认值）", () => {
    expect(getGenreById("not-a-genre")).toBeNull();
    expect(getGenreById("")).toBeNull();
    expect(getGenreById(null)).toBeNull();
    expect(getGenreById(undefined)).toBeNull();
  });

  it("档位元信息查表同样对空值安全", () => {
    expect(getGenreTierMeta("avoid")?.label).toBe("避开");
    expect(getGenreTierMeta(null)).toBeNull();
    expect(getGenreTierMeta(undefined)).toBeNull();
  });
});

describe("resolveGenreAdvisory 风险提示", () => {
  it("避开档返回 danger 级提示，含恐怖谷与真人短剧对撞理由", () => {
    const advisory = resolveGenreAdvisory("dushi-richang");
    expect(advisory).not.toBeNull();
    expect(advisory?.severity).toBe("danger");
    expect(advisory?.tierLabel).toBe("避开");
    expect(advisory?.caution).toContain("恐怖谷");
  });

  it("平台不要档返回 danger 级提示，含分账系数理由", () => {
    const advisory = resolveGenreAdvisory("jieshuo");
    expect(advisory?.severity).toBe("danger");
    expect(advisory?.caution).toContain("1/5");
  });

  it("红海档返回 warn 级（慎入不等于避开）", () => {
    expect(resolveGenreAdvisory("nixi")?.severity).toBe("warn");
  });

  it("推荐档与空值无提示（不给正向选项挂警告）", () => {
    expect(resolveGenreAdvisory("yineng")).toBeNull();
    expect(resolveGenreAdvisory("")).toBeNull();
    expect(resolveGenreAdvisory(null)).toBeNull();
    expect(resolveGenreAdvisory("not-a-genre")).toBeNull();
  });
});

describe("buildGenreGuidanceBlock / buildGenreContextBlock prompt 注入块", () => {
  it("矩阵内题材：块里含题材名与创作要点", () => {
    const block = buildGenreGuidanceBlock("yineng");
    const genre = getGenreById("yineng")!;
    expect(block).toContain(genre.label);
    expect(block).toContain(genre.craftNote);
  });

  it("空值 / 未知 id 返回空串（拼接后与改前逐字一致，零回归）", () => {
    expect(buildGenreGuidanceBlock("")).toBe("");
    expect(buildGenreGuidanceBlock(null)).toBe("");
    expect(buildGenreGuidanceBlock(undefined)).toBe("");
    expect(buildGenreGuidanceBlock("not-a-genre")).toBe("");
  });

  it("注入块不含任何数据结论（播放量/部数不该进 prompt，那是给人看的）", () => {
    for (const genre of GENRE_OPTIONS) {
      const block = buildGenreGuidanceBlock(genre.id);
      expect(block).not.toContain(genre.rationale);
      expect(block).not.toContain(genre.source);
    }
  });

  it("自由文本题材只声明题材名，不编造创作要点", () => {
    const block = buildFreeformGenreBlock("赛博悬疑");
    expect(block).toContain("赛博悬疑");
    expect(block).not.toContain("创作要点");
    expect(buildFreeformGenreBlock("  ")).toBe("");
    expect(buildFreeformGenreBlock(null)).toBe("");
  });

  it("统一入口：矩阵内走带要点版本，矩阵外走自由文本版本，空值返回空串", () => {
    expect(buildGenreContextBlock("moshi")).toBe(
      buildGenreGuidanceBlock("moshi")
    );
    expect(buildGenreContextBlock("赛博悬疑")).toBe(
      buildFreeformGenreBlock("赛博悬疑")
    );
    expect(buildGenreContextBlock("")).toBe("");
    expect(buildGenreContextBlock(null)).toBe("");
    expect(buildGenreContextBlock(undefined)).toBe("");
  });
});

describe("连载建议（F4，按有效时长分账）", () => {
  it("SERIALIZATION_ADVICE 含分账公式与分段结构，且带来源", () => {
    expect(SERIALIZATION_ADVICE.detail).toContain("有效时长");
    expect(SERIALIZATION_ADVICE.phases.length).toBeGreaterThan(0);
    expect(SERIALIZATION_ADVICE.source.trim().length).toBeGreaterThan(0);
  });

  it("短目标时长不提示（单集常规区间不打扰用户）", () => {
    expect(resolveSerializationHint(90)).toBeNull();
    expect(resolveSerializationHint(180)).toBeNull();
  });

  it("长目标时长给出拆连载提示（纯提示，不改参数）", () => {
    const hint = resolveSerializationHint(300);
    expect(hint).not.toBeNull();
    expect(hint).toContain("连载");
  });

  it("非法时长返回 null（NaN / Infinity 不触发提示）", () => {
    expect(resolveSerializationHint(Number.NaN)).toBeNull();
    expect(resolveSerializationHint(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
