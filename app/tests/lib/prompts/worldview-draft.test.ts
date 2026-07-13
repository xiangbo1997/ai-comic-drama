import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildWorldviewDraftPrompt,
  WORLDVIEW_DRAFT_SYSTEM,
  type WorldviewDraftInput,
} from "@/lib/prompts/worldview-draft";
import { parseLooseJSON } from "@/lib/json-repair";

// 与路由 DraftSchema 保持一致（此处独立声明，测端到端解析行为）
const DraftSchema = z.object({
  worldview: z.string().trim().min(1),
  protagonist: z.string().trim().min(1),
  genre: z.string().trim().min(1),
  filmTitle: z.string().trim().min(1),
});

function makeInput(
  overrides: Partial<WorldviewDraftInput> = {}
): WorldviewDraftInput {
  return {
    idea: "重生复仇爽剧，女主是被陷害的豪门千金",
    ...overrides,
  };
}

describe("buildWorldviewDraftPrompt", () => {
  it("包含用户想法与竖屏短剧 + 冲突钩子约束", () => {
    const prompt = buildWorldviewDraftPrompt(makeInput());
    expect(prompt).toContain("重生复仇爽剧，女主是被陷害的豪门千金");
    expect(prompt).toContain("竖屏短剧");
    expect(prompt).toContain("冲突钩子");
    // 四字段名都出现在输出 JSON 模板里
    expect(prompt).toContain("worldview");
    expect(prompt).toContain("protagonist");
    expect(prompt).toContain("genre");
    expect(prompt).toContain("filmTitle");
  });

  it("有 genre 时注入题材倾向；无则不注入", () => {
    expect(buildWorldviewDraftPrompt(makeInput({ genre: "玄幻" }))).toContain(
      "题材倾向：玄幻"
    );
    expect(buildWorldviewDraftPrompt(makeInput())).not.toContain("题材倾向");
  });

  it("有 seriesContext 时注入系列前情衔接约束", () => {
    const prompt = buildWorldviewDraftPrompt(
      makeInput({ seriesContext: "上一集主角刚夺回家族企业" })
    );
    expect(prompt).toContain("系列前情");
    expect(prompt).toContain("上一集主角刚夺回家族企业");
  });

  it("裁剪 idea 首尾空白", () => {
    const prompt = buildWorldviewDraftPrompt(
      makeInput({ idea: "  测试想法  " })
    );
    expect(prompt).toContain("一句话想法：测试想法");
    expect(prompt).not.toContain("一句话想法：  测试想法");
  });

  it("system prompt 声明只输出 JSON", () => {
    expect(WORLDVIEW_DRAFT_SYSTEM).toContain("JSON");
  });
});

describe("worldview DraftSchema 解析（含畸形 JSON 容错）", () => {
  it("解析规范 JSON", () => {
    const raw = JSON.stringify({
      worldview: "在架空的苍潮界，一条失落的航路埋着惊天秘密。",
      protagonist: "被家族放逐的少年航海者",
      genre: "玄幻冒险",
      filmTitle: "苍潮秘航",
    });
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
  });

  it("容错 markdown code fence + trailing comma + 智能引号", () => {
    const raw =
      "```json\n{“worldview”: “架空世界的复仇故事，充满反转钩子”, “protagonist”: “被陷害的千金”, “genre”: “重生复仇”, “filmTitle”: “重生千金”,}\n```";
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filmTitle).toBe("重生千金");
    }
  });

  it("缺字段 / 空字段被 Zod 拒绝", () => {
    const raw = JSON.stringify({
      worldview: "有世界观",
      protagonist: "",
      genre: "都市",
      filmTitle: "标题",
    });
    expect(DraftSchema.safeParse(parseLooseJSON(raw)).success).toBe(false);
  });
});
