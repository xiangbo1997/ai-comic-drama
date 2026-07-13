import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildAppearanceDraftPrompt,
  APPEARANCE_DRAFT_SYSTEM,
  APPEARANCE_PRESETS,
  type AppearanceDraftInput,
} from "@/lib/prompts/appearance-draft";
import { parseLooseJSON } from "@/lib/json-repair";

// 与路由 DraftSchema 一致：10 字段，缺失/null 回落
const ClothingPresetSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim(),
});
const DraftSchema = z.object({
  hairStyle: z.string().catch("").default(""),
  hairColor: z.string().catch("").default(""),
  faceShape: z.string().catch("").default(""),
  eyeColor: z.string().catch("").default(""),
  bodyType: z.string().catch("").default(""),
  height: z.string().catch("").default(""),
  skinTone: z.string().catch("").default(""),
  accessories: z.string().catch("").default(""),
  freeText: z.string().catch("").default(""),
  clothingPresets: z.array(ClothingPresetSchema).catch([]).default([]),
});

function makeInput(
  overrides: Partial<AppearanceDraftInput> = {}
): AppearanceDraftInput {
  return {
    name: "林萧",
    gender: "male",
    age: "24",
    description: "黑色短发，身材挺拔，眼神锐利",
    ...overrides,
  };
}

describe("buildAppearanceDraftPrompt", () => {
  it("包含角色信息与全部 10 字段名", () => {
    const prompt = buildAppearanceDraftPrompt(makeInput());
    expect(prompt).toContain("林萧");
    expect(prompt).toContain("黑色短发，身材挺拔，眼神锐利");
    for (const field of [
      "hairStyle",
      "hairColor",
      "faceShape",
      "eyeColor",
      "bodyType",
      "height",
      "skinTone",
      "accessories",
      "freeText",
      "clothingPresets",
    ]) {
      expect(prompt).toContain(field);
    }
  });

  it("把 UI 预设选项喂给 LLM（发型/发色/脸型/瞳色/体型/肤色）", () => {
    const prompt = buildAppearanceDraftPrompt(makeInput());
    // 抽查几个预设值确实出现在 prompt 里，引导 LLM 优先选预设
    expect(prompt).toContain(APPEARANCE_PRESETS.hairStyle.join("、"));
    expect(prompt).toContain(APPEARANCE_PRESETS.eyeColor.join("、"));
    expect(prompt).toContain(APPEARANCE_PRESETS.skinTone.join("、"));
  });

  it("强调中文输出", () => {
    expect(buildAppearanceDraftPrompt(makeInput())).toContain("用中文");
    expect(APPEARANCE_DRAFT_SYSTEM).toContain("中文");
  });

  it("性别映射：male→男 / female→女 / 空→未指定", () => {
    expect(buildAppearanceDraftPrompt(makeInput({ gender: "male" }))).toContain(
      "性别：男"
    );
    expect(
      buildAppearanceDraftPrompt(makeInput({ gender: "female" }))
    ).toContain("性别：女");
    expect(
      buildAppearanceDraftPrompt(makeInput({ gender: undefined }))
    ).toContain("性别：未指定");
  });

  it("description 为空时提示仅凭名字/性别/年龄推断", () => {
    const prompt = buildAppearanceDraftPrompt(makeInput({ description: "" }));
    expect(prompt).toContain("仅凭名字");
  });

  it("预设常量与 appearance-editor 六个下拉字段数量对齐", () => {
    // 防止预设漂移：编辑器有 6 个 chip 字段
    expect(Object.keys(APPEARANCE_PRESETS)).toEqual([
      "hairStyle",
      "hairColor",
      "faceShape",
      "eyeColor",
      "bodyType",
      "skinTone",
    ]);
  });
});

describe("appearance DraftSchema 解析（含畸形 JSON 容错）", () => {
  it("解析规范 10 字段 JSON", () => {
    const raw = JSON.stringify({
      hairStyle: "短发",
      hairColor: "黑色",
      faceShape: "方脸",
      eyeColor: "黑色",
      bodyType: "健壮",
      height: "182cm",
      skinTone: "自然肤色",
      accessories: "",
      freeText: "眼神锐利",
      clothingPresets: [{ name: "日常装", description: "深色夹克配衬衫" }],
    });
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hairStyle).toBe("短发");
      expect(result.data.clothingPresets).toHaveLength(1);
    }
  });

  it("null 字段回落空串，不整单挂", () => {
    const raw = JSON.stringify({
      hairStyle: "短发",
      hairColor: null,
      faceShape: "方脸",
      eyeColor: "黑色",
      bodyType: "健壮",
      height: null,
      skinTone: "自然肤色",
      accessories: null,
      freeText: "",
      clothingPresets: null,
    });
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hairColor).toBe("");
      expect(result.data.height).toBe("");
      expect(result.data.clothingPresets).toEqual([]);
    }
  });

  it("容错 code fence + 单引号 + trailing comma", () => {
    const raw =
      "```\n{'hairStyle':'长直发','hairColor':'棕色','faceShape':'瓜子脸','eyeColor':'棕色','bodyType':'纤细','height':'165cm','skinTone':'白皙','accessories':'','freeText':'','clothingPresets':[],}\n```";
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hairStyle).toBe("长直发");
    }
  });
});
