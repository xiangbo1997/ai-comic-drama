import { describe, expect, it } from "vitest";

import {
  assignVoices,
  voiceDisplayName,
  ASSIGNABLE_VOICE_COUNT,
} from "@/lib/voice-casting";
import { VOLCANO_NARRATOR_VOICE_ID } from "@/lib/tts-voice";

/**
 * 音色分配契约。
 *
 * 背景：此前角色没手动设音色就全部回落 provider 默认，典型成片是旁白一个磁性
 * 男声、所有角色不分男女老少全是同一个甜美女声——观众三秒内就能判定"这是 AI 做的"。
 */
describe("assignVoices", () => {
  it("同性别多角色拿到不同音色（项目内互斥）", () => {
    const result = assignVoices([
      { id: "a", gender: "female" },
      { id: "b", gender: "female" },
      { id: "c", gender: "female" },
    ]);
    const voices = [...result.values()];
    expect(voices.length).toBe(3);
    expect(new Set(voices).size).toBe(3);
  });

  it("按性别取对应音色池", () => {
    const result = assignVoices([
      { id: "f", gender: "female" },
      { id: "m", gender: "male" },
    ]);
    expect(result.get("f")).toContain("zh_female");
    expect(result.get("m")).toContain("zh_male");
  });

  it("识别中文与缩写性别写法", () => {
    const result = assignVoices([
      { id: "a", gender: "女" },
      { id: "b", gender: "M" },
      { id: "c", gender: "男性" },
    ]);
    expect(result.get("a")).toContain("zh_female");
    expect(result.get("b")).toContain("zh_male");
    expect(result.get("c")).toContain("zh_male");
  });

  it("旁白音色不参与角色分配——否则角色会和说书人同声", () => {
    // male 池里排除旁白音色后仍有值，且分配结果不含它
    const result = assignVoices([
      { id: "a", gender: "male" },
      { id: "b", gender: "male" },
      { id: "c", gender: "male" },
      { id: "d", gender: "male" },
    ]);
    for (const voice of result.values()) {
      expect(voice).not.toBe(VOLCANO_NARRATOR_VOICE_ID);
    }
  });

  it("已有音色的角色被跳过——用户手选与系列前作分配的都不覆盖", () => {
    const result = assignVoices([
      { id: "kept", gender: "female", voiceId: "zh_female_linjie_moon_bigtts" },
      { id: "new", gender: "female" },
    ]);
    expect(result.has("kept")).toBe(false);
    expect(result.has("new")).toBe(true);
  });

  it("新角色避开已被手选占用的音色", () => {
    const taken = "zh_female_shuangkuaisisi_moon_bigtts";
    const result = assignVoices([
      { id: "manual", gender: "female", voiceId: taken },
      { id: "auto1", gender: "female" },
      { id: "auto2", gender: "female" },
    ]);
    expect(result.get("auto1")).not.toBe(taken);
    expect(result.get("auto2")).not.toBe(taken);
    expect(result.get("auto1")).not.toBe(result.get("auto2"));
  });

  it("角色数超过池容量时轮转复用，不漏分配", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      gender: "female",
    }));
    const result = assignVoices(many);
    // 每个角色都拿到音色（即便有复用）
    expect(result.size).toBe(10);
    for (const v of result.values()) expect(v).toBeTruthy();
  });

  it("性别未知走兜底池，角色间仍尽量互不相同", () => {
    const result = assignVoices([
      { id: "a" },
      { id: "b", gender: "" },
      { id: "c", gender: "不明" },
    ]);
    expect(result.size).toBe(3);
    expect(new Set(result.values()).size).toBe(3);
  });

  it("空输入返回空 Map", () => {
    expect(assignVoices([]).size).toBe(0);
  });

  it("可分配音色数 > 1——否则分配毫无意义", () => {
    expect(ASSIGNABLE_VOICE_COUNT).toBeGreaterThan(1);
  });
});

describe("voiceDisplayName", () => {
  it("已知音色返回中文名", () => {
    expect(voiceDisplayName("zh_female_linjie_moon_bigtts")).toBe("知性女声");
  });

  it("未知 / 空值返回 null", () => {
    expect(voiceDisplayName("unknown")).toBeNull();
    expect(voiceDisplayName(null)).toBeNull();
    expect(voiceDisplayName(undefined)).toBeNull();
  });
});
