import { describe, it, expect } from "vitest";
import {
  mergeNullableFields,
  mergeAppearanceFields,
  bibleAppearanceToFields,
} from "@/services/agents/character-bible-merge";
import type { CharacterBibleEntry } from "@/services/agents/types";

/** bible 的完整外貌（含 unknown 混入，用于验证归一） */
function bibleAppearance(
  over: Partial<CharacterBibleEntry["appearance"]> = {}
): CharacterBibleEntry["appearance"] {
  return {
    gender: "female",
    age: "20",
    hairStyle: "long straight",
    hairColor: "black",
    faceShape: "oval",
    eyeColor: "brown",
    bodyType: "slim",
    skinTone: "fair",
    height: "165cm",
    clothing: "white dress",
    accessories: "silver necklace",
    ...over,
  };
}

describe("mergeNullableFields（C1：只补空字段）", () => {
  it("现有字段为 null 时用 bible 值填充", () => {
    const patch = mergeNullableFields(
      { gender: null, age: null, description: null },
      { gender: "female", age: "20", description: "冷静的黑客" }
    );
    expect(patch).toEqual({
      gender: "female",
      age: "20",
      description: "冷静的黑客",
    });
  });

  it("现有字段已有值时绝不覆盖（保护用户手改）", () => {
    const patch = mergeNullableFields(
      { gender: "男", age: "25", description: "用户手写人设" },
      { gender: "female", age: "20", description: "bible 人设" }
    );
    expect(patch).toEqual({});
  });

  it("空串 / 纯空格视为未填，会被 bible 值补上", () => {
    const patch = mergeNullableFields(
      { gender: "", age: "   ", description: null },
      { gender: "female", age: "20", description: "冷静的黑客" }
    );
    expect(patch).toEqual({
      gender: "female",
      age: "20",
      description: "冷静的黑客",
    });
  });

  it("部分已填部分为空：只补空的，已填的保持不动", () => {
    const patch = mergeNullableFields(
      { gender: "男", age: null, description: null },
      { gender: "female", age: "20", description: "bible 人设" }
    );
    expect(patch).toEqual({ age: "20", description: "bible 人设" });
    expect(patch).not.toHaveProperty("gender");
  });

  it("bible 值为空时不补（现有仍为 null 保持 null）", () => {
    const patch = mergeNullableFields(
      { gender: null, age: null, description: null },
      { gender: null, age: null, description: null }
    );
    expect(patch).toEqual({});
  });
});

describe("bibleAppearanceToFields（unknown 归一）", () => {
  it("unknown / 空值归一为 null，其余原样", () => {
    const fields = bibleAppearanceToFields(
      bibleAppearance({ faceShape: "unknown", accessories: "  ", height: "" })
    );
    expect(fields.faceShape).toBeNull();
    expect(fields.accessories).toBeNull();
    expect(fields.height).toBeNull();
    expect(fields.hairColor).toBe("black");
    expect(fields.clothing).toBe("white dress");
  });

  it("大小写不敏感识别 unknown", () => {
    const fields = bibleAppearanceToFields(
      bibleAppearance({ eyeColor: "Unknown", bodyType: "UNKNOWN" })
    );
    expect(fields.eyeColor).toBeNull();
    expect(fields.bodyType).toBeNull();
  });
});

describe("mergeAppearanceFields（C1：只补空外貌字段）", () => {
  it("现有外貌字段为 null 时用 bible 值补", () => {
    const bible = bibleAppearanceToFields(bibleAppearance());
    const patch = mergeAppearanceFields(
      {
        hairStyle: null,
        hairColor: null,
        eyeColor: null,
        freeText: null,
      },
      bible
    );
    expect(patch.hairStyle).toBe("long straight");
    expect(patch.hairColor).toBe("black");
    expect(patch.eyeColor).toBe("brown");
    // clothing 落 freeText
    expect(patch.freeText).toBe("white dress");
  });

  it("现有外貌字段已填时绝不覆盖", () => {
    const bible = bibleAppearanceToFields(bibleAppearance());
    const patch = mergeAppearanceFields(
      {
        hairStyle: "用户填的短发",
        hairColor: "金色",
        freeText: "用户填的自由描述",
      },
      bible
    );
    expect(patch).not.toHaveProperty("hairStyle");
    expect(patch).not.toHaveProperty("hairColor");
    expect(patch).not.toHaveProperty("freeText");
  });

  it("bible 值为 null（unknown 归一）时不补该字段", () => {
    const bible = bibleAppearanceToFields(
      bibleAppearance({ faceShape: "unknown" })
    );
    const patch = mergeAppearanceFields({ faceShape: null }, bible);
    expect(patch).not.toHaveProperty("faceShape");
  });

  it("混合：现有部分已填部分为空，只补空的", () => {
    const bible = bibleAppearanceToFields(bibleAppearance());
    const patch = mergeAppearanceFields(
      { hairStyle: "已填", hairColor: null, skinTone: null, freeText: null },
      bible
    );
    expect(patch).not.toHaveProperty("hairStyle");
    expect(patch.hairColor).toBe("black");
    expect(patch.skinTone).toBe("fair");
    expect(patch.freeText).toBe("white dress");
  });
});
