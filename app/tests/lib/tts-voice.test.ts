import { describe, it, expect } from "vitest";
import {
  normalizeVoiceFamily,
  resolveDialogueVoiceId,
  resolveNarratorVoiceId,
  VOLCANO_NARRATOR_VOICE_ID,
} from "@/lib/tts-voice";

describe("normalizeVoiceFamily（厂商家族归一）", () => {
  it("火山家族归一到 volcano", () => {
    expect(normalizeVoiceFamily("volcano")).toBe("volcano");
    expect(normalizeVoiceFamily("volcengine")).toBe("volcano");
    expect(normalizeVoiceFamily("bytedance")).toBe("volcano");
    expect(normalizeVoiceFamily("VOLCENGINE")).toBe("volcano");
  });

  it("elevenlabs / gpt-sovits 各归其类", () => {
    expect(normalizeVoiceFamily("elevenlabs")).toBe("elevenlabs");
    expect(normalizeVoiceFamily("gpt-sovits")).toBe("gpt-sovits");
    expect(normalizeVoiceFamily("gptsovits")).toBe("gpt-sovits");
    expect(normalizeVoiceFamily("some-sovits-tunnel")).toBe("gpt-sovits");
  });

  it("未知 / 空 → 空串", () => {
    expect(normalizeVoiceFamily("openai")).toBe("");
    expect(normalizeVoiceFamily(undefined)).toBe("");
    expect(normalizeVoiceFamily(null)).toBe("");
    expect(normalizeVoiceFamily("")).toBe("");
  });
});

describe("resolveDialogueVoiceId（对白角色声线跨厂商防污染）", () => {
  it("家族匹配 → 采用角色 voiceId", () => {
    expect(
      resolveDialogueVoiceId({
        characterVoiceId: "zh_male_yangguang_moon_bigtts",
        characterVoiceProvider: "volcano",
        activeFamily: "volcano",
      })
    ).toBe("zh_male_yangguang_moon_bigtts");
  });

  it("家族不匹配（角色火山，激活 ElevenLabs）→ undefined 回落默认", () => {
    expect(
      resolveDialogueVoiceId({
        characterVoiceId: "zh_male_yangguang_moon_bigtts",
        characterVoiceProvider: "volcano",
        activeFamily: "elevenlabs",
      })
    ).toBeUndefined();
  });

  it("角色无 voiceId → undefined", () => {
    expect(
      resolveDialogueVoiceId({
        characterVoiceId: null,
        characterVoiceProvider: "volcano",
        activeFamily: "volcano",
      })
    ).toBeUndefined();
  });

  it("激活家族无法判定（空串）→ undefined（按不匹配处理）", () => {
    expect(
      resolveDialogueVoiceId({
        characterVoiceId: "zh_male_yangguang_moon_bigtts",
        characterVoiceProvider: "volcano",
        activeFamily: "",
      })
    ).toBeUndefined();
  });

  it("角色 voiceProvider 无法判定 → undefined", () => {
    expect(
      resolveDialogueVoiceId({
        characterVoiceId: "some_voice",
        characterVoiceProvider: null,
        activeFamily: "volcano",
      })
    ).toBeUndefined();
  });
});

describe("resolveNarratorVoiceId（旁白独立声线）", () => {
  it("火山家族 → 磁性男声旁白默认", () => {
    expect(resolveNarratorVoiceId("volcano")).toBe(VOLCANO_NARRATOR_VOICE_ID);
  });

  it("非火山家族（ElevenLabs/gpt-sovits/空）→ undefined 走 provider 默认", () => {
    expect(resolveNarratorVoiceId("elevenlabs")).toBeUndefined();
    expect(resolveNarratorVoiceId("gpt-sovits")).toBeUndefined();
    expect(resolveNarratorVoiceId("")).toBeUndefined();
  });

  it("旁白声线是男声（与默认甜美女声区分）", () => {
    expect(VOLCANO_NARRATOR_VOICE_ID).toContain("male");
  });
});
