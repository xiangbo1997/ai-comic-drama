import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildPromptSuggestPrompt,
  PROMPT_SUGGEST_SYSTEM,
  type PromptSuggestInput,
} from "@/lib/prompts/prompt-suggest";
import { parseLooseJSON } from "@/lib/json-repair";

// 与路由 DraftSchema 一致：≥1 条非空短句，截断到 3
const DraftSchema = z.object({
  suggestions: z
    .array(z.string().trim().min(1))
    .min(1)
    .transform((arr) => arr.slice(0, 3)),
});

describe("buildPromptSuggestPrompt · character_reference", () => {
  const input: PromptSuggestInput = {
    context: "character_reference",
    character: {
      name: "林萧",
      gender: "male",
      age: "24",
      description: "黑色短发，眼神锐利",
    },
  };

  it("包含角色信息与 suggestions 输出约束", () => {
    const prompt = buildPromptSuggestPrompt(input);
    expect(prompt).toContain("林萧");
    expect(prompt).toContain("黑色短发，眼神锐利");
    expect(prompt).toContain("suggestions");
    expect(prompt).toContain("角色");
  });

  it("有 currentPrompt 时要求互补不重复", () => {
    const prompt = buildPromptSuggestPrompt({
      ...input,
      currentPrompt: "换个发型",
    });
    expect(prompt).toContain("换个发型");
    expect(prompt).toContain("互补");
  });

  it("无角色信息时降级为通用建议，不报错", () => {
    const prompt = buildPromptSuggestPrompt({
      context: "character_reference",
    });
    expect(prompt).toContain("无角色信息");
  });
});

describe("buildPromptSuggestPrompt · scene_iterate", () => {
  const input: PromptSuggestInput = {
    context: "scene_iterate",
    scene: {
      description: "女主站在窗前",
      emotion: "sad",
      shotType: "近景",
      dialogue: "他真的走了…",
    },
  };

  it("包含分镜信息（景别/情绪/画面/台词）", () => {
    const prompt = buildPromptSuggestPrompt(input);
    expect(prompt).toContain("近景");
    expect(prompt).toContain("sad");
    expect(prompt).toContain("女主站在窗前");
    expect(prompt).toContain("他真的走了");
  });

  it("面向画面氛围/光线/构图的调整指令", () => {
    const prompt = buildPromptSuggestPrompt(input);
    expect(prompt).toContain("迭代调整");
    expect(prompt).toContain("光线");
  });

  it("无分镜信息时降级为通用建议", () => {
    const prompt = buildPromptSuggestPrompt({ context: "scene_iterate" });
    expect(prompt).toContain("无分镜信息");
  });

  it("system prompt 声明只输出 JSON", () => {
    expect(PROMPT_SUGGEST_SYSTEM).toContain("JSON");
  });
});

describe("prompt-suggest DraftSchema 解析（含畸形 JSON 容错）", () => {
  it("解析规范 JSON 并保留全部（≤3）", () => {
    const raw = JSON.stringify({
      suggestions: ["换成温柔微笑", "改为战斗姿态", "加一件披风"],
    });
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestions).toHaveLength(3);
    }
  });

  it("多于 3 条时截断到 3", () => {
    const raw = JSON.stringify({
      suggestions: ["a", "b", "c", "d", "e"],
    });
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestions).toEqual(["a", "b", "c"]);
    }
  });

  it("容错 code fence + 智能引号 + trailing comma", () => {
    const raw =
      "```json\n{“suggestions”: [“把背景改成夜晚”, “让她笑起来”,]}\n```";
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestions).toEqual(["把背景改成夜晚", "让她笑起来"]);
    }
  });

  it("空数组被拒绝（无可用建议不应通过）", () => {
    const raw = JSON.stringify({ suggestions: [] });
    expect(DraftSchema.safeParse(parseLooseJSON(raw)).success).toBe(false);
  });
});
