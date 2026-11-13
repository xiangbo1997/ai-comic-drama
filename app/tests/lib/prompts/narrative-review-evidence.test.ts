import { describe, expect, it } from "vitest";
import {
  buildStoryboardReviewPrompt,
  type SceneSummary,
} from "@/lib/prompts/agent-prompts/narrative-review";

const scene: SceneSummary = {
  id: 9,
  shotType: "特写",
  emotion: "fear",
  characters: ["阿宁"],
  description: "阿宁将钥匙藏进袖口，门锁突然转动。",
};

describe("叙事评审依据", () => {
  it("提供实际台词、旁白和累计时间，供开场与外化评审使用", () => {
    const prompt = buildStoryboardReviewPrompt([
      { ...scene, duration: 2, dialogue: "别开门！", narration: null },
      {
        ...scene,
        id: 12,
        duration: 4,
        dialogue: null,
        narration: "门外是她失踪的哥哥。",
      },
    ]);
    expect(prompt).toContain("0–2s");
    expect(prompt).toContain("2–6s");
    expect(prompt).toContain("别开门！");
    expect(prompt).toContain("门外是她失踪的哥哥。");
    expect(prompt).toContain("旁白覆盖：1/2 镜（50%）");
    expect(prompt).toContain("总时长：6s");
  });

  it("缺失旧字段与明确无旁白分开，未知时长不能伪造时间轴", () => {
    const prompt = buildStoryboardReviewPrompt([
      { ...scene, duration: 2, narration: null },
      scene,
      { ...scene, id: 15, duration: 4, narration: null },
    ]);
    expect(prompt).toContain("旁白覆盖：未知（1/3 镜缺少旁白字段）");
    expect(prompt).toContain("总时长：未知");
    expect(prompt).not.toContain("2–6s");
    expect(prompt).toContain("不得把未知数据当作零值或据此扣分");
  });

  it.each([0, -2, NaN, Infinity])("非法时长 %s 标为未知", (duration) => {
    expect(buildStoryboardReviewPrompt([{ ...scene, duration }])).toContain(
      "总时长：未知"
    );
  });

  it("空列表不产生虚假百分比", () => {
    const prompt = buildStoryboardReviewPrompt([]);
    expect(prompt).toContain("无分镜，无法评审");
    expect(prompt).not.toContain("NaN");
  });
});
