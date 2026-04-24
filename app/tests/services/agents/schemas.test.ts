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
