import { describe, it, expect } from "vitest";
import {
  buildCharacterBasePrompt,
  buildCharacterPromptWithCustom,
  type CharacterPromptInput,
} from "@/lib/prompts/character-reference";

function makeCharacter(
  overrides: Partial<CharacterPromptInput> = {}
): CharacterPromptInput {
  return {
    name: "小熊布布",
    gender: "female",
    age: "6",
    description: "圆脸，棕色短毛，粉色围裙",
    tags: [{ tag: { name: "萌宠" } }, { tag: { name: "治愈" } }],
    ...overrides,
  };
}

describe("buildCharacterPromptWithCustom（自定义提示词提权）", () => {
  it("无自定义提示词时，等价于 base prompt（不引入额外包裹）", () => {
    const character = makeCharacter();
    expect(buildCharacterPromptWithCustom(character, undefined)).toBe(
      buildCharacterBasePrompt(character)
    );
    expect(buildCharacterPromptWithCustom(character, "   ")).toBe(
      buildCharacterBasePrompt(character)
    );
  });

  it("用户指令被提到 prompt 最前面（位置提权，防止被 base 关键词淹没）", () => {
    const prompt = buildCharacterPromptWithCustom(
      makeCharacter(),
      "开口笑，可爱一点"
    );
    // 根因回归：此前用户短句被 append 到末尾权重极低。
    // 提权后必须出现在 base（含角色名）之前。
    const customPos = prompt.indexOf("开口笑，可爱一点");
    const basePos = prompt.indexOf("小熊布布");
    expect(customPos).toBeGreaterThanOrEqual(0);
    expect(basePos).toBeGreaterThan(customPos);
  });

  it("用带最高优先级的英文声明包裹用户指令（语义提权）", () => {
    const prompt = buildCharacterPromptWithCustom(makeCharacter(), "换成短发");
    expect(prompt).toContain("highest priority");
    expect(prompt).toContain("换成短发");
  });

  it("base prompt 仍作为身份锚点保留，不丢失角色信息", () => {
    const prompt = buildCharacterPromptWithCustom(makeCharacter(), "开口笑");
    // 身份关键字段仍在（名字、外貌、标签）
    expect(prompt).toContain("小熊布布");
    expect(prompt).toContain("圆脸");
    expect(prompt).toContain("萌宠");
  });

  it("自定义提示词首尾空白被裁剪", () => {
    const prompt = buildCharacterPromptWithCustom(
      makeCharacter(),
      "  开口笑  "
    );
    expect(prompt).toContain("must follow): 开口笑.");
    expect(prompt).not.toContain("must follow):   开口笑");
  });
});
