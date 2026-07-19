import { describe, it, expect } from "vitest";
import {
  mapEmotionToVolcengine,
  mapEmotionToElevenLabs,
} from "@/lib/tts-emotion";

describe("mapEmotionToVolcengine（火山 emotion 映射）", () => {
  it("映射有情绪到火山 emotion 值", () => {
    expect(mapEmotionToVolcengine("happy")).toBe("happy");
    expect(mapEmotionToVolcengine("sad")).toBe("sad");
    expect(mapEmotionToVolcengine("angry")).toBe("angry");
    expect(mapEmotionToVolcengine("surprised")).toBe("surprised");
    expect(mapEmotionToVolcengine("fear")).toBe("fear");
  });

  it("neutral → undefined（不下发 emotion 参数）", () => {
    expect(mapEmotionToVolcengine("neutral")).toBeUndefined();
  });

  it("空/null/未知 → undefined", () => {
    expect(mapEmotionToVolcengine(undefined)).toBeUndefined();
    expect(mapEmotionToVolcengine(null)).toBeUndefined();
    expect(mapEmotionToVolcengine("")).toBeUndefined();
    expect(mapEmotionToVolcengine("excited")).toBeUndefined();
  });

  it("大小写 / 空白容错", () => {
    expect(mapEmotionToVolcengine(" HAPPY ")).toBe("happy");
    expect(mapEmotionToVolcengine("Angry")).toBe("angry");
  });
});

describe("mapEmotionToElevenLabs（ElevenLabs voice_settings 情绪覆盖）", () => {
  it("有情绪返回 stability/style 覆盖", () => {
    const angry = mapEmotionToElevenLabs("angry");
    expect(angry).toBeDefined();
    // angry：低 stability + 高 style（更有张力）
    expect(angry!.stability).toBeLessThan(0.5);
    expect(angry!.style).toBeGreaterThan(0);

    const sad = mapEmotionToElevenLabs("sad");
    expect(sad).toBeDefined();
    // sad：高 stability（沉稳克制）
    expect(sad!.stability).toBeGreaterThan(0.5);
  });

  it("高唤醒情绪 stability 低于低唤醒情绪", () => {
    const angry = mapEmotionToElevenLabs("angry")!;
    const sad = mapEmotionToElevenLabs("sad")!;
    expect(angry.stability).toBeLessThan(sad.stability);
  });

  it("neutral / 空 / null / 未知 → undefined（保持 provider 默认）", () => {
    expect(mapEmotionToElevenLabs("neutral")).toBeUndefined();
    expect(mapEmotionToElevenLabs(undefined)).toBeUndefined();
    expect(mapEmotionToElevenLabs(null)).toBeUndefined();
    expect(mapEmotionToElevenLabs("")).toBeUndefined();
    expect(mapEmotionToElevenLabs("excited")).toBeUndefined();
  });

  it("所有情绪 stability/style 在 [0,1] 保守区间内", () => {
    for (const e of ["happy", "sad", "angry", "surprised", "fear"]) {
      const s = mapEmotionToElevenLabs(e)!;
      expect(s.stability).toBeGreaterThanOrEqual(0);
      expect(s.stability).toBeLessThanOrEqual(1);
      expect(s.style).toBeGreaterThanOrEqual(0);
      expect(s.style).toBeLessThanOrEqual(1);
    }
  });
});
