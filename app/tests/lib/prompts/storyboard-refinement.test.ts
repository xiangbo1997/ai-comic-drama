import { describe, it, expect } from "vitest";
import { buildStoryboardPrompt } from "@/lib/prompts/agent-prompts";

/**
 * 闭环3 修订回注：叙事评审不达标时把 verdict.suggestions 作为约束回注分镜 prompt。
 *
 * 关键不变量是「位置」而非「是否包含」——短句 append 到长 prompt 末尾会被淹没
 * （项目已有教训：buildCharacterPromptWithCustom 的语义稀释），故断言修订块
 * 必须出现在角色清单与原始分镜之前。
 */

const scenes = [
  {
    id: 1,
    shotType: "中景",
    description: "主角推开门走进房间",
    characters: ["林小满"],
    dialogue: "你终于来了",
    narration: null,
    emotion: "tense",
    duration: 3,
  },
];

const bible = [
  {
    name: "林小满",
    canonicalPrompt: "1girl, short black hair, red jacket",
    appearance: { hair: "short black" },
  },
];

describe("buildStoryboardPrompt · 叙事评审修订回注", () => {
  it("无 refinement（首轮）→ 不出现修订块，行为与接入前一致", () => {
    const prompt = buildStoryboardPrompt(scenes, bible);
    expect(prompt).not.toContain("修订重生成");
    expect(prompt.startsWith("基于以下场景和角色圣经")).toBe(true);
  });

  it("空串 / 纯空白 refinement 视为无修订", () => {
    expect(buildStoryboardPrompt(scenes, bible, "")).not.toContain(
      "修订重生成"
    );
    expect(buildStoryboardPrompt(scenes, bible, "   \n  ")).not.toContain(
      "修订重生成"
    );
  });

  it("有 refinement → 修订块置于 prompt 最顶部（抢在角色清单之前）", () => {
    const prompt = buildStoryboardPrompt(
      scenes,
      bible,
      "第1镜改为冲突最高点画面\n结尾停在未解决的危机上"
    );
    const refineIdx = prompt.indexOf("修订重生成");
    const charIdx = prompt.indexOf("角色标准提示词");
    const sceneIdx = prompt.indexOf("原始分镜");

    expect(refineIdx).toBeGreaterThanOrEqual(0);
    // 位置即权重：修订指令必须在角色清单与原始分镜之前，否则会被淹没
    expect(refineIdx).toBeLessThan(charIdx);
    expect(refineIdx).toBeLessThan(sceneIdx);
    expect(prompt).toContain("第1镜改为冲突最高点画面");
    expect(prompt).toContain("结尾停在未解决的危机上");
  });

  it("修订块明确要求不得照搬上一版", () => {
    const prompt = buildStoryboardPrompt(scenes, bible, "外化内心戏");
    expect(prompt).toContain("不要原样照搬上一版");
  });

  it("修订态仍保留原有 JSON 输出契约与 imagePrompt 构造规则", () => {
    const prompt = buildStoryboardPrompt(scenes, bible, "外化内心戏");
    expect(prompt).toContain("输出纯 JSON");
    expect(prompt).toContain("imagePrompt 构造规则");
    expect(prompt).toContain("1girl, short black hair, red jacket");
  });
});
