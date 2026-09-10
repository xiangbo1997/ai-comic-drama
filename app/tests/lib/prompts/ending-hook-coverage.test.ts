import { describe, expect, it } from "vitest";

import { SCRIPT_PARSE_SYSTEM } from "@/lib/prompts/script-parse";
import { buildEventMapBlock } from "@/lib/prompts/script-parse";
import { SCRIPT_PARSER_SYSTEM } from "@/lib/prompts/agent-prompts/script-parser";
import { DRAMA_SCRIPT_SYSTEM } from "@/lib/prompts/agent-prompts/drama-script";
import { ScriptArtifactZ } from "@/services/agents/schemas";
import { HOOK_TYPES } from "@/types/series-bible";

/**
 * 结尾钩子覆盖契约。
 *
 * 背景：创作路径有完整的 hookType 链（枚举 → prompt → Zod → 史官读取），
 * 而两条解析路径**完全没有这个字段**——review-report 的 hook 节因此对解析型
 * 项目无脑 warn，等于系统自己承认这条路径的结尾钩子无人负责。
 *
 * 长篇网文拆集，「断点设计」是拆集工序的第一优先级：上集最后 5 秒决定下集
 * 打开率。而连载正是分账规则下唯一划算的形态——系统一边让用户做连载，
 * 一边在解析路径上不产出连载最需要的断口。
 */

const MINIMAL_SCENE = {
  id: 1,
  shotType: "中景",
  description: "她站在门口，手停在把手上",
  characters: ["林晚"],
  dialogue: null,
  narration: null,
  emotion: "紧张",
  duration: 3,
};

describe("三条管线的结尾钩子覆盖", () => {
  const PIPELINES: ReadonlyArray<readonly [string, string]> = [
    ["服务层直连解析 script-parse", SCRIPT_PARSE_SYSTEM],
    ["Agent 解析路径 script-parser", SCRIPT_PARSER_SYSTEM],
    ["世界观创作路径 drama-script", DRAMA_SCRIPT_SYSTEM],
  ];

  it.each(PIPELINES)("%s 要求输出 hookType", (_name, systemPrompt) => {
    expect(systemPrompt).toContain("hookType");
  });

  it.each(PIPELINES)("%s 列出五类钩子", (_name, systemPrompt) => {
    for (const hook of HOOK_TYPES) {
      expect(systemPrompt).toContain(hook);
    }
  });

  it("两条解析路径都要求 endingHook 与断点优先", () => {
    for (const prompt of [SCRIPT_PARSE_SYSTEM, SCRIPT_PARSER_SYSTEM]) {
      expect(prompt).toContain("endingHook");
      expect(prompt).toContain("断点优先");
      // 断口不能留在情绪落地处——这是拆集的核心纪律
      expect(prompt).toContain("调整切分边界");
    }
  });

  it("事件地图规则含断点优先，禁止在平铺卡上断集", () => {
    const block = buildEventMapBlock([
      "第1段：主角被赶出家门（情绪强度：转折）",
    ]);
    expect(block).toContain("断点优先");
    expect(block).toContain("平铺");
  });
});

describe("ScriptArtifactZ 承接钩子字段", () => {
  it("合法 hookType 被保留", () => {
    const parsed = ScriptArtifactZ.parse({
      title: "测试",
      scenes: [MINIMAL_SCENE],
      characters: [{ name: "林晚", description: "24岁，黑色长发，身材纤细" }],
      hookType: "悬念",
      endingHook: "她推开门，看见本该死去的人",
    });
    expect(parsed.hookType).toBe("悬念");
    expect(parsed.endingHook).toBe("她推开门，看见本该死去的人");
  });

  it("缺省时为 undefined——存量脚本零回归", () => {
    const parsed = ScriptArtifactZ.parse({
      title: "测试",
      scenes: [MINIMAL_SCENE],
      characters: [{ name: "林晚", description: "24岁，黑色长发，身材纤细" }],
    });
    expect(parsed.hookType).toBeUndefined();
    expect(parsed.endingHook).toBeUndefined();
  });

  it("非法 hookType 降级为 undefined 而非抛错——钩子是增强项不该阻断解析", () => {
    const parsed = ScriptArtifactZ.parse({
      title: "测试",
      scenes: [MINIMAL_SCENE],
      characters: [{ name: "林晚", description: "24岁，黑色长发，身材纤细" }],
      hookType: "莫名其妙的类型",
    });
    expect(parsed.hookType).toBeUndefined();
  });
});
