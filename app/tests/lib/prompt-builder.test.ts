import { describe, it, expect } from "vitest";
import {
  buildEnhancedPrompt,
  promptStyleFromProtocol,
  type BuildPromptOptions,
} from "@/lib/prompt-builder";
import { getStylePack } from "@/lib/prompts/style-packs";
import type { SceneAnalysis } from "@/types/character";

/** 最小可用的场景分析结果（单角色 + 动作/环境/光线齐全） */
function makeAnalysis(overrides?: Partial<SceneAnalysis>): SceneAnalysis {
  return {
    characterActions: [
      {
        characterName: "林岚",
        action: "clenching fists",
        expression: "glaring",
        position: "center",
      },
    ],
    environment: "abandoned warehouse at night",
    lighting: "夜晚",
    mood: "tense",
    interaction: "",
    ...overrides,
  } as SceneAnalysis;
}

function makeOptions(
  overrides?: Partial<BuildPromptOptions>
): BuildPromptOptions {
  return {
    style: "anime",
    characters: [
      {
        id: "c1",
        name: "林岚",
        gender: "female",
        age: 22,
        description: "long black hair, red jacket",
      },
    ],
    analysis: makeAnalysis(),
    shotType: "特写",
    originalPrompt: "she stands her ground",
    ...overrides,
  } as BuildPromptOptions;
}

describe("promptStyleFromProtocol", () => {
  it("SD 系协议（replicate/fal/siliconflow）→ tags", () => {
    expect(promptStyleFromProtocol("replicate")).toBe("tags");
    expect(promptStyleFromProtocol("Fal")).toBe("tags");
    expect(promptStyleFromProtocol("siliconflow")).toBe("tags");
  });

  it("指令类 / 未知 / 空 → natural（安全默认）", () => {
    expect(promptStyleFromProtocol("openai")).toBe("natural");
    expect(promptStyleFromProtocol("gemini")).toBe("natural");
    expect(promptStyleFromProtocol(undefined)).toBe("natural");
    expect(promptStyleFromProtocol(null)).toBe("natural");
  });
});

describe("buildEnhancedPrompt 新排序（漫剧化重排）", () => {
  it("风格锚开头；镜头语言先于角色出现（前置高权重）", () => {
    const prompt = buildEnhancedPrompt(
      makeOptions({
        cinematics: {
          cameraAngle: "low-angle shot",
          composition: "rule of thirds",
        },
      })
    );
    const anchor = getStylePack("anime").anchor;
    expect(prompt.startsWith(anchor)).toBe(true);
    const idxCamera = prompt.indexOf("low-angle shot");
    const idxCharacter = prompt.indexOf("林岚");
    expect(idxCamera).toBeGreaterThan(-1);
    expect(idxCharacter).toBeGreaterThan(-1);
    expect(idxCamera).toBeLessThan(idxCharacter);
  });

  it("9:16 注入竖屏构图基线；其它画幅不注入", () => {
    const vertical = buildEnhancedPrompt(makeOptions({ aspectRatio: "9:16" }));
    expect(vertical).toContain("vertical composition");
    const horizontal = buildEnhancedPrompt(
      makeOptions({ aspectRatio: "16:9" })
    );
    expect(horizontal).not.toContain("vertical composition");
  });

  it("高唤醒情绪 + 特写触发夸张表情语法（动漫画风含漫画符号）", () => {
    const prompt = buildEnhancedPrompt(makeOptions({ emotion: "angry" }));
    // 特写 + angry → climax 强度，动漫画风应出现表情爆发词汇
    expect(prompt.toLowerCase()).toMatch(/furious|rage|gritted/);
  });

  it("写实画风不注入漫画符号词（speed lines 等）", () => {
    const prompt = buildEnhancedPrompt(
      makeOptions({ style: "realistic", emotion: "angry" })
    );
    expect(prompt.toLowerCase()).not.toContain("speed lines");
  });

  it("质量词按协议分流：tags 用 booru 标签，natural 用自然语言", () => {
    const tags = buildEnhancedPrompt(makeOptions({ promptStyle: "tags" }));
    expect(tags).toContain("masterpiece");
    const natural = buildEnhancedPrompt(
      makeOptions({ promptStyle: "natural" })
    );
    expect(natural).not.toContain("masterpiece");
  });

  it("legacyOrdering=true 回退旧排序（质量词布局不同于新排序）", () => {
    const modern = buildEnhancedPrompt(makeOptions());
    const legacy = buildEnhancedPrompt(makeOptions({ legacyOrdering: true }));
    expect(legacy).not.toBe(modern);
    // 旧排序把系列色板/画风色彩基线中文段放前面（保留原行为）
    expect(legacy).toContain("色彩风格基线");
  });

  it("无 cinematics/emotion 时不产生空段（逗号序列干净）", () => {
    const prompt = buildEnhancedPrompt(makeOptions());
    expect(prompt).not.toMatch(/,\s*,/);
    expect(prompt.trim().length).toBeGreaterThan(0);
  });
});
