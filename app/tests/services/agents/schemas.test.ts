import { describe, it, expect } from "vitest";
import {
  ScriptArtifactZ,
  CharacterBibleZ,
  StoryboardArtifactZ,
  SceneScriptZ,
  validateAgentOutput,
} from "@/services/agents/schemas";

describe("ScriptArtifactZ", () => {
  const minimalScene = {
    id: 1,
    shotType: "中景",
    description: "一个人站在窗前，窗外下着雨",
    characters: ["林萧"],
    dialogue: null,
    narration: null,
    emotion: "sad",
    duration: 3,
  };

  it("accepts a minimal valid script", () => {
    const data = {
      title: "小说",
      scenes: [minimalScene],
      characters: [{ name: "林萧", description: "24岁女性" }],
    };
    const r = ScriptArtifactZ.safeParse(data);
    expect(r.success).toBe(true);
  });

  it("rejects when scenes array is empty", () => {
    const r = ScriptArtifactZ.safeParse({
      title: "x",
      scenes: [],
      characters: [{ name: "a", description: "aaaaa" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("CharacterBibleZ", () => {
  const minimalAppearance = {
    gender: "female",
    age: "24",
    hairStyle: "long",
    hairColor: "black",
    faceShape: "oval",
    eyeColor: "brown",
    bodyType: "slim",
    skinTone: "fair",
    height: "165cm",
    clothing: "business suit",
    accessories: "none",
  };

  it("accepts a minimal valid bible", () => {
    const r = CharacterBibleZ.safeParse({
      characters: [
        {
          name: "林萧",
          description: "24岁女性",
          canonicalPrompt: "female, 24 years old, long black hair",
          appearance: minimalAppearance,
          voiceProfile: { gender: "female", age: "24", tone: "neutral" },
          appearances: [1, 2, 3],
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("StoryboardArtifactZ", () => {
  it("validates a nested scene with imagePrompt >= 20 chars", () => {
    const r = StoryboardArtifactZ.safeParse({
      scenes: [
        {
          id: 1,
          order: 1,
          shotType: "中景",
          description: "一个人站在窗前，窗外下着雨",
          imagePrompt:
            "anime style, female character standing at window, rainy mood",
          characters: ["林萧"],
          dialogue: null,
          narration: null,
          emotion: "sad",
          duration: 3,
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("SceneScriptZ optional cinema fields (Stage 1.8)", () => {
  it("accepts extra cameraAngle / lighting / composition / colorPalette fields", () => {
    const r = SceneScriptZ.safeParse({
      id: 1,
      shotType: "近景",
      description: "林萧靠在墙边，泪水在眼眶里打转",
      characters: ["林萧"],
      dialogue: null,
      narration: null,
      emotion: "sad",
      duration: 4,
      cameraAngle: "eye-level",
      lighting: "soft window light",
      composition: "rule of thirds",
      colorPalette: "desaturated cool tones",
    });
    expect(r.success).toBe(true);
  });

  it("still accepts when those optional fields are absent", () => {
    const r = SceneScriptZ.safeParse({
      id: 1,
      shotType: "近景",
      description: "林萧靠在墙边，泪水在眼眶里打转",
      characters: ["林萧"],
      dialogue: null,
      narration: null,
      emotion: "sad",
      duration: 4,
    });
    expect(r.success).toBe(true);
  });
});

describe("SceneScriptZ director fields (cameraMovement / actionBeat)", () => {
  const base = {
    id: 1,
    shotType: "近景",
    description: "林萧靠在墙边，泪水在眼眶里打转",
    characters: ["林萧"],
    dialogue: null,
    narration: null,
    emotion: "sad",
    duration: 4,
  };

  it("accepts a valid 13-value cameraMovement + actionBeat", () => {
    const r = SceneScriptZ.safeParse({
      ...base,
      cameraMovement: "dolly_in",
      actionBeat: "指尖收紧攥皱信纸，泪水将落未落",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cameraMovement).toBe("dolly_in");
      expect(r.data.actionBeat).toBe("指尖收紧攥皱信纸，泪水将落未落");
    }
  });

  it("invalid cameraMovement falls back to undefined (does not fail the scene)", () => {
    const r = SceneScriptZ.safeParse({
      ...base,
      cameraMovement: "whip_pan",
      actionBeat: "急速转身",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cameraMovement).toBeUndefined();
      expect(r.data.actionBeat).toBe("急速转身");
    }
  });
});

describe("SceneScriptZ characterOutfits（分镜级换装标注）", () => {
  const base = {
    id: 1,
    shotType: "全景",
    description: "林萧身着婚纱缓步走向圣坛，宾客起立注视",
    characters: ["林萧"],
    dialogue: null,
    narration: null,
    emotion: "happy",
    duration: 5,
  };

  it("接受合法的 characterOutfits 数组", () => {
    const r = SceneScriptZ.safeParse({
      ...base,
      characterOutfits: [{ name: "林萧", outfit: "白色婚纱" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.characterOutfits).toEqual([
        { name: "林萧", outfit: "白色婚纱" },
      ]);
    }
  });

  it("outfit 超 20 字被截断", () => {
    const longOutfit = "一".repeat(30);
    const r = SceneScriptZ.safeParse({
      ...base,
      characterOutfits: [{ name: "林萧", outfit: longOutfit }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.characterOutfits?.[0].outfit).toHaveLength(20);
    }
  });

  it("空数组归一为 undefined（不落无意义空值）", () => {
    const r = SceneScriptZ.safeParse({ ...base, characterOutfits: [] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.characterOutfits).toBeUndefined();
    }
  });

  it("name/outfit 任一为空的条目被过滤", () => {
    const r = SceneScriptZ.safeParse({
      ...base,
      characterOutfits: [
        { name: "林萧", outfit: "白色婚纱" },
        { name: "", outfit: "黑西装" },
        { name: "路人", outfit: "  " },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.characterOutfits).toEqual([
        { name: "林萧", outfit: "白色婚纱" },
      ]);
    }
  });

  it("非法（非数组）值 .catch 回落 undefined，不让整镜校验失败", () => {
    const r = SceneScriptZ.safeParse({
      ...base,
      characterOutfits: "白色婚纱",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.characterOutfits).toBeUndefined();
    }
  });

  it("缺省该字段时正常通过", () => {
    const r = SceneScriptZ.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.characterOutfits).toBeUndefined();
    }
  });
});

describe("validateAgentOutput()", () => {
  it("throws readable error with agent name and issue paths on failure", () => {
    expect(() =>
      validateAgentOutput(
        ScriptArtifactZ,
        { title: "", scenes: [], characters: [] },
        "script_parser"
      )
    ).toThrow(/script_parser/);
  });
});
