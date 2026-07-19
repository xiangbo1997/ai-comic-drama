import { describe, it, expect } from "vitest";
import {
  STYLE_PACKS,
  STYLE_PACK_OPTIONS,
  getStylePack,
  getStylePaletteBaseline,
  type StylePack,
} from "@/lib/prompts/style-packs";
import {
  getStylePrefix,
  getSimpleStylePrefix,
} from "@/lib/prompts/image-prompt";

/** 旧平面风格映射的全部 9 个 id（向后兼容硬要求：都必须能解析） */
const LEGACY_STYLE_IDS = [
  "anime",
  "realistic",
  "comic",
  "watercolor",
  "oil",
  "sketch",
  "3d",
  "cyberpunk",
  "fantasy",
] as const;

/** 5 个 Toonflow 改编的完整画风包 id（内容非空 + 遵守预算） */
const FULL_PACK_IDS = [
  "anime90s",
  "guofeng2d",
  "anime3d",
  "guofeng-cyber",
  "urban2d",
] as const;

/** 完整包的字段字符预算（与设计契约一致） */
const BUDGETS: Record<keyof StylePack, number> = {
  id: Infinity,
  label: Infinity,
  description: Infinity,
  anchor: 220,
  colorSystem: 600,
  colorSystemEn: 160,
  moodPalettes: 500,
  characterRules: 400,
  sceneRules: 300,
  sceneRulesEn: 160,
  negative: Infinity,
  legacy: Infinity,
};

describe("STYLE_PACKS 注册表", () => {
  it("id 全局唯一", () => {
    const ids = STYLE_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("覆盖全部 9 个旧平面风格 id + 5 个新完整包 id", () => {
    const ids = new Set(STYLE_PACKS.map((p) => p.id));
    for (const id of LEGACY_STYLE_IDS) expect(ids.has(id)).toBe(true);
    for (const id of FULL_PACK_IDS) expect(ids.has(id)).toBe(true);
  });

  it("每个包的 anchor 均遵守 220 字预算，且非空", () => {
    for (const pack of STYLE_PACKS) {
      expect(pack.anchor.trim().length).toBeGreaterThan(0);
      expect(pack.anchor.length).toBeLessThanOrEqual(BUDGETS.anchor);
    }
  });

  it("每个包 negative 非空（风格特化负向词）", () => {
    for (const pack of STYLE_PACKS) {
      expect(pack.negative.trim().length).toBeGreaterThan(0);
    }
  });

  it("英文精炼字段（colorSystemEn/sceneRulesEn）遵守预算；有中文版的包英文版必须非空", () => {
    for (const pack of STYLE_PACKS) {
      expect(pack.colorSystemEn.length).toBeLessThanOrEqual(
        BUDGETS.colorSystemEn
      );
      expect(pack.sceneRulesEn.length).toBeLessThanOrEqual(
        BUDGETS.sceneRulesEn
      );
      // 有中文 colorSystem/sceneRules 的包必须配套英文精炼版（进英文 prompt 用）；
      // legacy 平面风格两者皆空，行为不变
      if (pack.colorSystem.trim()) {
        expect(pack.colorSystemEn.trim().length).toBeGreaterThan(0);
      }
      if (pack.sceneRules.trim()) {
        expect(pack.sceneRulesEn.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getStylePack 向后兼容", () => {
  it("全部 9 个旧 style id 都能解析到同名包", () => {
    for (const id of LEGACY_STYLE_IDS) {
      expect(getStylePack(id).id).toBe(id);
    }
  });

  it("未知 style 回落到 anime", () => {
    expect(getStylePack("brutalist-xx").id).toBe("anime");
    expect(getStylePack(undefined).id).toBe("anime");
    expect(getStylePack(null).id).toBe("anime");
    expect(getStylePack("").id).toBe("anime");
  });
});

describe("5 个完整画风包内容质量", () => {
  it.each(FULL_PACK_IDS)("%s 的五段内容均非空且遵守字符预算", (id) => {
    const pack = getStylePack(id);
    expect(pack.legacy).not.toBe(true);
    for (const field of [
      "anchor",
      "colorSystem",
      "moodPalettes",
      "characterRules",
      "sceneRules",
      "negative",
    ] as const) {
      expect(pack[field].trim().length).toBeGreaterThan(0);
      expect(pack[field].length).toBeLessThanOrEqual(BUDGETS[field]);
    }
  });
});

describe("legacy 兜底风格", () => {
  it("oil/sketch/3d/cyberpunk/fantasy 标记 legacy 且色彩块为空", () => {
    for (const id of ["oil", "sketch", "3d", "cyberpunk", "fantasy"]) {
      const pack = getStylePack(id);
      expect(pack.legacy).toBe(true);
      expect(pack.colorSystem).toBe("");
      expect(pack.moodPalettes).toBe("");
      expect(pack.characterRules).toBe("");
      expect(pack.sceneRules).toBe("");
    }
  });
});

describe("getStylePrefix / getSimpleStylePrefix 从画风包派生", () => {
  it("getStylePrefix 返回包 anchor", () => {
    expect(getStylePrefix("anime")).toBe(getStylePack("anime").anchor);
    expect(getStylePrefix("anime90s")).toBe(getStylePack("anime90s").anchor);
  });

  it("getStylePrefix 未知风格回落 anime anchor", () => {
    expect(getStylePrefix("unknown-xx")).toBe(getStylePack("anime").anchor);
  });

  it("getSimpleStylePrefix 取 anchor 首子句 + 尾逗号", () => {
    const simple = getSimpleStylePrefix("anime");
    expect(simple.endsWith(",")).toBe(true);
    // 首子句应是 anchor 逗号前的部分
    const firstClause = getStylePack("anime").anchor.split(",")[0].trim();
    expect(simple).toBe(`${firstClause},`);
  });

  it("getSimpleStylePrefix 未知风格回落 anime 首子句", () => {
    expect(getSimpleStylePrefix("unknown-xx")).toBe(
      getSimpleStylePrefix("anime")
    );
  });
});

describe("getStylePaletteBaseline", () => {
  it("完整包返回 colorSystem + moodPalettes 拼接串（非空）", () => {
    const baseline = getStylePaletteBaseline("anime90s");
    expect(baseline.length).toBeGreaterThan(0);
    expect(baseline).toContain(getStylePack("anime90s").colorSystem.trim());
    expect(baseline).toContain(getStylePack("anime90s").moodPalettes.trim());
  });

  it("legacy 平面风格返回空串", () => {
    expect(getStylePaletteBaseline("oil")).toBe("");
    expect(getStylePaletteBaseline("cyberpunk")).toBe("");
  });
});

describe("STYLE_PACK_OPTIONS（UI 派生）", () => {
  it("与 STYLE_PACKS 顺序一致、字段齐全", () => {
    expect(STYLE_PACK_OPTIONS.length).toBe(STYLE_PACKS.length);
    STYLE_PACK_OPTIONS.forEach((opt, i) => {
      expect(opt.value).toBe(STYLE_PACKS[i].id);
      expect(opt.label).toBe(STYLE_PACKS[i].label);
      expect(opt.description).toBe(STYLE_PACKS[i].description);
    });
  });

  it("默认 anime 排在首位（默认选项）", () => {
    expect(STYLE_PACK_OPTIONS[0].value).toBe("anime");
  });
});
