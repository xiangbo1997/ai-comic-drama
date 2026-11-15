import { describe, expect, it } from "vitest";
import {
  applySubtitleOverrides,
  normalizeSubtitleOverrides,
} from "@/lib/subtitle-overrides";
import { buildSubtitleSourceText } from "@/lib/subtitle-segments";
import { normalizeGenerationParams } from "@/lib/generation-params-normalize";

const scene = {
  id: "s1",
  narration: "旁白",
  dialogue: "对白",
  audioUrl: "/uploads/voice.mp3",
};
describe("独立字幕编辑", () => {
  it("覆盖字幕不改变配音原文与音频", () => {
    const [edited] = applySubtitleOverrides(
      [scene],
      [{ sceneId: "s1", text: "修正后的字幕" }]
    );
    expect(buildSubtitleSourceText(edited)).toBe("修正后的字幕");
    expect(edited).toMatchObject(scene);
    expect(buildSubtitleSourceText(scene)).toBe("旁白\n对白");
  });
  it("空覆盖移除字幕，去掉覆盖恢复默认，其他镜头不受影响", () => {
    const edited = applySubtitleOverrides(
      [scene, { ...scene, id: "s2" }],
      [{ sceneId: "s1", text: "" }]
    );
    expect(buildSubtitleSourceText(edited[0])).toBe("");
    expect(buildSubtitleSourceText(edited[1])).toBe("旁白\n对白");
    expect(
      buildSubtitleSourceText(applySubtitleOverrides([scene], [])[0])
    ).toBe("旁白\n对白");
  });
  it("覆盖通过参数白名单保存并规范无效输入、重复项及上限", () => {
    const input = [
      null,
      { sceneId: "", text: "x" },
      { sceneId: "s1", text: "旧" },
      { sceneId: "s1", text: "新" },
      { sceneId: "s2", text: 3 },
    ];
    expect(normalizeSubtitleOverrides(input)).toEqual([
      { sceneId: "s1", text: "新" },
    ]);
    expect(
      normalizeGenerationParams({
        subtitleOverrides: [{ sceneId: "s1", text: "" }],
      })
    ).toMatchObject({ subtitleOverrides: [{ sceneId: "s1", text: "" }] });
    expect(
      normalizeSubtitleOverrides(
        Array.from({ length: 600 }, (_, i) => ({
          sceneId: `s${i}`,
          text: "x".repeat(6000),
        }))
      )
    ).toHaveLength(500);
    expect(
      normalizeSubtitleOverrides([{ sceneId: "s1", text: "x".repeat(6000) }])[0]
        .text
    ).toHaveLength(5000);
  });
});
