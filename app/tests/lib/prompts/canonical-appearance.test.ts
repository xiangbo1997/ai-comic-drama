import { describe, it, expect } from "vitest";
import {
  buildCanonicalAppearanceText,
  buildCanonicalAppearanceFields,
  buildCanonicalCharacterEntry,
  STYLE_LIGHTING_LOCK,
  type CanonicalAppearanceInput,
} from "@/lib/prompts/canonical-appearance";
import { buildAppearanceFeatures } from "@/lib/prompts/character-reference";
import type { CharacterAppearanceInput } from "@/lib/prompts/character-reference";

/** 完整 9 字段外貌（用于顺序与确定性断言） */
const fullAppearance: CharacterAppearanceInput = {
  hairColor: "navy blue",
  hairStyle: "short bob",
  faceShape: "oval face",
  eyeColor: "amber",
  bodyType: "slender",
  height: "165cm",
  skinTone: "fair",
  accessories: "silver earrings",
  freeText: "navy blue bomber jacket",
};

function makeInput(
  overrides: Partial<CanonicalAppearanceInput> = {}
): CanonicalAppearanceInput {
  return {
    gender: "female",
    age: "22",
    description: "气质冷淡",
    appearance: fullAppearance,
    ...overrides,
  };
}

describe("buildCanonicalAppearanceText — 确定性（同输入必同输出）", () => {
  it("同一输入对象重复调用，结果逐字相同", () => {
    const input = makeInput();
    const first = buildCanonicalAppearanceText(input);
    const runs = Array.from({ length: 20 }, () =>
      buildCanonicalAppearanceText(input)
    );
    for (const r of runs) expect(r).toBe(first);
  });

  it("语义相同但对象键声明顺序不同，结果逐字相同（不依赖键枚举顺序）", () => {
    // 刻意用完全颠倒的键顺序构造同一份外貌数据
    const reversed: CharacterAppearanceInput = {
      freeText: fullAppearance.freeText,
      accessories: fullAppearance.accessories,
      skinTone: fullAppearance.skinTone,
      height: fullAppearance.height,
      bodyType: fullAppearance.bodyType,
      eyeColor: fullAppearance.eyeColor,
      faceShape: fullAppearance.faceShape,
      hairStyle: fullAppearance.hairStyle,
      hairColor: fullAppearance.hairColor,
    };
    expect(
      buildCanonicalAppearanceText(makeInput({ appearance: reversed }))
    ).toBe(buildCanonicalAppearanceText(makeInput()));
  });

  it("字段顺序固定：性别 → 年龄 → 结构化外貌（固定内部次序）→ description", () => {
    const text = buildCanonicalAppearanceText(makeInput());
    expect(text).toBe(
      "female, 22 years old, navy blue short bob, oval face, amber eyes, " +
        "slender, fair skin, 165cm, silver earrings, navy blue bomber jacket, 气质冷淡"
    );
  });

  it("空白差异被折叠：多余空格/换行/尾随逗号不改变输出", () => {
    const messy = buildCanonicalAppearanceText({
      gender: "  female  ",
      age: " 22 ",
      description: "气质冷淡,",
      appearance: {
        hairColor: " navy   blue ",
        hairStyle: "short bob\n",
        faceShape: "oval face",
        eyeColor: "amber ",
        bodyType: "slender",
        height: "165cm",
        skinTone: "fair",
        accessories: "silver earrings;",
        freeText: "navy  blue bomber jacket ",
      },
    });
    expect(messy).toBe(buildCanonicalAppearanceText(makeInput()));
  });

  it("description 与结构化外貌互补：两者都带上（不再互相丢弃）", () => {
    const text = buildCanonicalAppearanceText(makeInput());
    // 结构化字段在
    expect(text).toContain("amber eyes");
    // description 也在（此前 strategy-resolver 有结构化外貌就丢 description）
    expect(text).toContain("气质冷淡");
  });

  it("全空输入返回空串（调用方按无外貌处理）", () => {
    expect(buildCanonicalAppearanceText({})).toBe("");
    expect(
      buildCanonicalAppearanceText({ appearance: null, description: null })
    ).toBe("");
    expect(buildCanonicalAppearanceText({ appearance: {} })).toBe("");
  });

  it("仅 description（旧数据）时也能产出文本", () => {
    expect(
      buildCanonicalAppearanceText({ description: "蓝色夹克，短发" })
    ).toBe("蓝色夹克，短发");
  });
});

describe("buildCanonicalAppearanceFields — 发色/发型合并与措辞冻结", () => {
  it("发色 + 发型齐备时合并为一个短语", () => {
    expect(
      buildCanonicalAppearanceFields({
        hairColor: "navy blue",
        hairStyle: "short bob",
      })
    ).toBe("navy blue short bob");
  });

  it("只有发型时单独出现", () => {
    expect(buildCanonicalAppearanceFields({ hairStyle: "short bob" })).toBe(
      "short bob"
    );
  });

  it("只有发色时单独出现", () => {
    expect(buildCanonicalAppearanceFields({ hairColor: "navy blue" })).toBe(
      "navy blue"
    );
  });

  it("eyeColor / skinTone 措辞恒定（eyes / skin 后缀）", () => {
    expect(
      buildCanonicalAppearanceFields({ eyeColor: "amber", skinTone: "fair" })
    ).toBe("amber eyes, fair skin");
  });

  it("空值返回空串", () => {
    expect(buildCanonicalAppearanceFields(undefined)).toBe("");
    expect(buildCanonicalAppearanceFields(null)).toBe("");
    expect(buildCanonicalAppearanceFields({})).toBe("");
  });
});

describe("buildCanonicalAppearanceText — 性别归一化", () => {
  it("male/男 → male；female/女 → female；未知 → 省略", () => {
    expect(buildCanonicalAppearanceText({ gender: "male" })).toBe("male");
    expect(buildCanonicalAppearanceText({ gender: "男" })).toBe("male");
    expect(buildCanonicalAppearanceText({ gender: "MALE" })).toBe("male");
    expect(buildCanonicalAppearanceText({ gender: "female" })).toBe("female");
    expect(buildCanonicalAppearanceText({ gender: "女" })).toBe("female");
    expect(buildCanonicalAppearanceText({ gender: "other" })).toBe("");
  });
});

describe("buildCanonicalCharacterEntry — 带名字的冻结条目", () => {
  it("输出 `名字: 外貌文本`", () => {
    expect(buildCanonicalCharacterEntry("林夏", makeInput())).toBe(
      `林夏: ${buildCanonicalAppearanceText(makeInput())}`
    );
  });

  it("带角色标注时拼在名字之后", () => {
    const entry = buildCanonicalCharacterEntry(
      "林夏",
      makeInput(),
      "(main character)"
    );
    expect(entry.startsWith("林夏(main character): ")).toBe(true);
  });

  it("外貌为空时仍保留名字锚点（不产出裸冒号）", () => {
    expect(buildCanonicalCharacterEntry("林夏", {})).toBe("林夏");
    expect(buildCanonicalCharacterEntry("林夏", {}, "(main character)")).toBe(
      "林夏(main character)"
    );
  });

  it("确定性：重复调用逐字相同", () => {
    const input = makeInput();
    const first = buildCanonicalCharacterEntry(
      "林夏",
      input,
      "(main character)"
    );
    for (let i = 0; i < 10; i++) {
      expect(
        buildCanonicalCharacterEntry("林夏", input, "(main character)")
      ).toBe(first);
    }
  });
});

describe("character-reference#buildAppearanceFeatures — 已收口到冻结真源", () => {
  it("与 buildCanonicalAppearanceFields 输出完全一致（同一真源）", () => {
    expect(buildAppearanceFeatures(fullAppearance)).toBe(
      buildCanonicalAppearanceFields(fullAppearance)
    );
  });

  it("空值行为不变（零回归）", () => {
    expect(buildAppearanceFeatures(undefined)).toBe("");
    expect(buildAppearanceFeatures(null)).toBe("");
    expect(buildAppearanceFeatures({})).toBe("");
  });
});

describe("STYLE_LIGHTING_LOCK — 画风/打光锁定句", () => {
  it("纯 ASCII（content-safety 不会拦）", () => {
    expect(/^[\x20-\x7E]+$/.test(STYLE_LIGHTING_LOCK)).toBe(true);
  });

  it("只声明不得重新诠释，不内联具体画风/光线内容（避免二次描述引入漂移）", () => {
    expect(STYLE_LIGHTING_LOCK).toContain("identical");
    expect(STYLE_LIGHTING_LOCK).toContain("do not reinterpret");
    // 不应出现具体画风名或具体布光名
    expect(STYLE_LIGHTING_LOCK).not.toMatch(/anime|rembrandt|golden hour/i);
  });
});

/**
 * 2026-09 新增的 6 个美术工业字段（hairParting/eyeHighlight/headToBodyRatio/
 * defaultOutfit/asymmetry/outfitDetails）。
 *
 * CANONICAL_FIELD_ORDER 是「冻结」实体，改动它通常属破坏性变更（需重生成定妆照）。
 * 本组测试钉死这次改动的安全性前提：**只新增字段、不动已有字段的顺序与措辞**，
 * 新字段对存量角色恒为 null 从而被过滤掉 —— 存量产出串逐字不变。
 */
describe("新增美术工业字段 — 存量零回归", () => {
  it("新字段全部缺省时，产出与新增前逐字相同", () => {
    // 这是新增字段前 fullAppearance 的历史产出串（硬编码快照，防未来改动悄悄漂移）
    expect(buildCanonicalAppearanceFields(fullAppearance)).toBe(
      "navy blue short bob, oval face, amber eyes, slender, fair skin, 165cm, silver earrings, navy blue bomber jacket"
    );
  });

  it("新字段显式为 null / undefined 与缺省等价", () => {
    const withNulls: CharacterAppearanceInput = {
      ...fullAppearance,
      hairParting: null,
      eyeHighlight: undefined,
      headToBodyRatio: null,
      defaultOutfit: undefined,
      asymmetry: null,
      outfitDetails: undefined,
    };
    expect(buildCanonicalAppearanceFields(withNulls)).toBe(
      buildCanonicalAppearanceFields(fullAppearance)
    );
  });

  it("新字段有值时按固定措辞与位置渲染", () => {
    const text = buildCanonicalAppearanceFields({
      ...fullAppearance,
      hairParting: "left",
      eyeHighlight: "top-right dot",
      headToBodyRatio: "7.5",
      defaultOutfit: "white cotton shirt under navy wool cardigan",
      asymmetry: "silver earring on left ear only",
      outfitDetails: "three white stripes on cuffs",
    });
    expect(text).toBe(
      "navy blue short bob, hair parted left, oval face, amber eyes, " +
        "top-right dot eye highlight, slender, 7.5 head-to-body ratio, fair skin, 165cm, " +
        "white cotton shirt under navy wool cardigan, " +
        "asymmetric detail: silver earring on left ear only, silver earrings, " +
        "outfit details: three white stripes on cuffs, navy blue bomber jacket"
    );
  });

  it("分缝紧跟发型、高光紧跟瞳色、头身比紧跟体型（相邻不被其它字段插开）", () => {
    const text = buildCanonicalAppearanceFields({
      hairColor: "black",
      hairStyle: "long straight",
      hairParting: "center",
      eyeColor: "brown",
      eyeHighlight: "double",
      bodyType: "slender",
      headToBodyRatio: "7",
    });
    expect(text).toBe(
      "black long straight, hair parted center, brown eyes, double eye highlight, slender, 7 head-to-body ratio"
    );
  });

  it("常服排在配饰之前（服装权重高于配饰）", () => {
    const text = buildCanonicalAppearanceFields({
      accessories: "round glasses",
      defaultOutfit: "grey hoodie",
    });
    expect(text).toBe("grey hoodie, round glasses");
  });

  it("服装标志物排在 freeText 之前（结构化身份信息不被自由文本淹没）", () => {
    const text = buildCanonicalAppearanceFields({
      freeText: "气质冷淡",
      outfitDetails: "silver badge on left chest",
    });
    expect(text).toBe("outfit details: silver badge on left chest, 气质冷淡");
  });

  it("新字段同样走空白折叠（与既有字段一致的规范化）", () => {
    expect(
      buildCanonicalAppearanceFields({ defaultOutfit: "  grey   hoodie  " })
    ).toBe(buildCanonicalAppearanceFields({ defaultOutfit: "grey hoodie" }));
    // 尾随逗号同样被去掉（与 hairColor 等既有字段行为一致）
    expect(
      buildCanonicalAppearanceFields({ defaultOutfit: "grey hoodie," })
    ).toBe(buildCanonicalAppearanceFields({ defaultOutfit: "grey hoodie" }));
  });
});
