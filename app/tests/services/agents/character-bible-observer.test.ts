import { describe, it, expect } from "vitest";
import { reviewCharacterBible } from "@/services/agents/character-bible-observer";
import type { CharacterBible } from "@/services/agents/types";

function char(
  name: string,
  opts: { prompt?: string; appearance?: Partial<Record<string, string>> } = {}
) {
  return {
    name,
    description: name,
    canonicalPrompt: opts.prompt ?? "",
    appearance: {
      gender: "female",
      age: "24",
      hairStyle: opts.appearance?.hairStyle ?? "",
      hairColor: opts.appearance?.hairColor ?? "",
      faceShape: opts.appearance?.faceShape ?? "",
      eyeColor: opts.appearance?.eyeColor ?? "",
      bodyType: opts.appearance?.bodyType ?? "",
      skinTone: "",
      height: "",
      clothing: opts.appearance?.clothing ?? "",
      accessories: "",
    },
    voiceProfile: { gender: "female", age: "24", tone: "soft" },
    appearances: [1],
  };
}

const fullAppearance = {
  hairStyle: "long straight",
  hairColor: "black",
  faceShape: "oval",
  eyeColor: "brown",
  bodyType: "slim",
  clothing: "white blouse, black skirt",
};

describe("reviewCharacterBible()", () => {
  it("空角色圣经：0 分不通过", () => {
    const v = reviewCharacterBible({ characters: [] });
    expect(v.score.overall).toBe(0);
    expect(v.pass).toBe(false);
    expect(v.retryable).toBe(true);
  });

  it("高质量圣经：通过", () => {
    const bible: CharacterBible = {
      characters: [
        char("林萧", {
          prompt:
            "24yo woman, long straight black hair, oval face, brown eyes, slim, white blouse black skirt, gentle",
          appearance: fullAppearance,
        }),
      ],
    };
    const v = reviewCharacterBible(bible);
    expect(v.pass).toBe(true);
    expect(v.score.overall).toBeGreaterThanOrEqual(70);
    expect(v.score.dimensions.coverage).toBe(100);
  });

  it("canonicalPrompt 缺失：coverage 低，给出建议", () => {
    const bible: CharacterBible = {
      characters: [
        char("林萧", { prompt: "", appearance: fullAppearance }),
        char("赵云", {
          prompt: "tall man with armor and spear, brave warrior look",
          appearance: fullAppearance,
        }),
      ],
    };
    const v = reviewCharacterBible(bible);
    expect(v.score.dimensions.coverage).toBe(50); // 2 个里 1 个有 prompt
    expect(v.suggestions.some((s) => s.includes("林萧"))).toBe(true);
  });

  it("描述过短：density 低", () => {
    const bible: CharacterBible = {
      characters: [char("路人", { prompt: "man", appearance: fullAppearance })],
    };
    const v = reviewCharacterBible(bible);
    expect(v.score.dimensions.density).toBeLessThan(70);
  });

  it("appearance 多占位：structure 低", () => {
    const bible: CharacterBible = {
      characters: [
        char("模糊角色", {
          prompt:
            "a person with some generic features described here long enough",
          appearance: { hairStyle: "unknown", hairColor: "unknown" },
        }),
      ],
    };
    const v = reviewCharacterBible(bible);
    expect(v.score.dimensions.structure).toBeLessThan(70);
  });
});
