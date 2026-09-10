import { describe, it, expect } from "vitest";
import { buildTtsTextPayload } from "@/lib/tts-request";
import { buildSubtitleSourceText } from "@/lib/subtitle-segments";

describe("buildTtsTextPayload（手动配音文本字段：旁白+对白双段）", () => {
  it("只有对白 → 单段 dialogue（原行为，不下发分段字段）", () => {
    expect(
      buildTtsTextPayload({ narration: null, dialogue: "你来了。" })
    ).toEqual({ text: "你来了。", kind: "dialogue" });
  });

  it("只有旁白 → 单段 narration（服务端给说书人声线）", () => {
    expect(
      buildTtsTextPayload({ narration: "夜色渐深。", dialogue: null })
    ).toEqual({ text: "夜色渐深。", kind: "narration" });
  });

  it("两者都有 → 双段：合并 text 供计费，两段原文分别下发", () => {
    expect(
      buildTtsTextPayload({ narration: "夜色渐深。", dialogue: "你来了。" })
    ).toEqual({
      text: "夜色渐深。\n你来了。",
      // 对白段用角色声线；旁白段由服务端单独解析说书人声线
      kind: "dialogue",
      narrationText: "夜色渐深。",
      dialogueText: "你来了。",
    });
  });

  it("两者都空 → null（调用方据此跳过，不发无意义请求）", () => {
    expect(buildTtsTextPayload({ narration: null, dialogue: null })).toBeNull();
    expect(buildTtsTextPayload({ narration: "  ", dialogue: "" })).toBeNull();
  });

  it("合并文本与字幕源文本完全一致 —— 配音念什么，字幕就显示什么", () => {
    const scene = { narration: "夜色渐深。", dialogue: "你来了。" };
    expect(buildTtsTextPayload(scene)?.text).toBe(
      buildSubtitleSourceText(scene)
    );
  });
});
