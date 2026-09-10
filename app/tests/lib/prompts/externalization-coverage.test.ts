import { describe, expect, it } from "vitest";

import {
  EXTERNALIZATION_RULES,
  NARRATION_DISCIPLINE_RULES,
} from "@/lib/prompts/adaptation-rules";
import { SCRIPT_PARSE_SYSTEM } from "@/lib/prompts/script-parse";
import { SCRIPT_PARSER_SYSTEM } from "@/lib/prompts/agent-prompts/script-parser";
import { DRAMA_SCRIPT_SYSTEM } from "@/lib/prompts/agent-prompts/drama-script";

/**
 * 画面纪律覆盖契约。
 *
 * 背景：外化 + 旁白纪律最初被定位为「小说→剧本改编工序」，因此世界观创作路径
 * （drama-script）没有注入——但这两块规则约束的是**输出形态**（description 里
 * 不许出现不可拍摄的心理状态词），与输入来源无关。创作路径没有原文约束时
 * LLM 反而更爱抒情，写出「她心中五味杂陈」直接污染下游出图 prompt。
 *
 * 凡是产出「要喂给图像模型的画面描述」的 prompt，都必须注入这两块。
 * 新增此类管线时若漏注入，此测试失败。
 */
describe("内心戏外化 / 旁白纪律的管线覆盖", () => {
  const PIPELINES: ReadonlyArray<readonly [string, string]> = [
    ["服务层直连解析 script-parse", SCRIPT_PARSE_SYSTEM],
    ["Agent 解析路径 script-parser", SCRIPT_PARSER_SYSTEM],
    ["世界观创作路径 drama-script", DRAMA_SCRIPT_SYSTEM],
  ];

  it.each(PIPELINES)("%s 注入了内心戏外化规则", (_name, systemPrompt) => {
    expect(systemPrompt).toContain(EXTERNALIZATION_RULES);
  });

  it.each(PIPELINES)("%s 注入了旁白纪律", (_name, systemPrompt) => {
    expect(systemPrompt).toContain(NARRATION_DISCIPLINE_RULES);
  });

  it("规则本体保留了不可拍摄心理词的禁令——这是外化的核心约束", () => {
    for (const word of ["他觉得", "她想", "意识到", "内心", "明白了", "心里"]) {
      expect(EXTERNALIZATION_RULES).toContain(word);
    }
  });

  it("规则措辞与文本来源无关，不再限定「小说」", () => {
    // 规则曾以「小说→剧本的核心改编工序」开篇，导致创作路径判断「我不是改编」
    // 而不注入。标题与首条纪律必须保持来源中立，否则 LLM 也会据此降低遵循度。
    const heading = EXTERNALIZATION_RULES.split("\n")[0];
    expect(heading).not.toContain("小说");
  });
});
