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
