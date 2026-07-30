/**
 * 解析层 sfx 标签清单与内置音效库同步性单测。
 *
 * 背景缺陷：script-parse.ts 里的 tag 清单曾是手写副本，与 sfx-library 扩容脱节——
 * 新增的 5 个分类与 6 条素材（comedy-boing / comedy-rimshot / comedy-fall-whistle /
 * comedy-scream-fall / suspense-drone / combat-bomb）压根不在 prompt 里，LLM 永远
 * 不会标注它们。改为 buildSfxTagListForPrompt() 程序化生成后，本测试当护栏：
 * 往音效库加素材而 prompt 没跟上，这里就会红。
 */

import { describe, it, expect } from "vitest";
import { SCRIPT_PARSE_SYSTEM } from "@/lib/prompts/script-parse";
import {
  SFX_CATEGORIES,
  SFX_LIBRARY,
  buildSfxTagListForPrompt,
} from "@/lib/sfx-library";

describe("buildSfxTagListForPrompt · 单一真源", () => {
  it("清单含全部分类 id", () => {
    const block = buildSfxTagListForPrompt();
    for (const c of SFX_CATEGORIES) {
      expect(block, `缺分类 ${c.id}`).toContain(c.id);
    }
  });

  it("清单含全部具体音效 id（含此前 prompt 漏掉的 6 条）", () => {
    const block = buildSfxTagListForPrompt();
    for (const s of SFX_LIBRARY) {
      expect(block, `缺音效 ${s.id}`).toContain(s.id);
    }
  });

  it("清单含中文语义提示（分类标签 + 音效标签，语义不退化）", () => {
    const block = buildSfxTagListForPrompt();
    for (const c of SFX_CATEGORIES) {
      expect(block, `缺分类标签 ${c.label}`).toContain(c.label);
    }
    // 抽查几条素材标签
    expect(block).toContain("玻璃粉碎");
    expect(block).toContain("捧哏鼓点");
    expect(block).toContain("阴森低鸣");
  });
});

describe("SCRIPT_PARSE_SYSTEM · 音效清单已注入", () => {
  it("system prompt 含全部音效 id（解析层能标注到每一条素材）", () => {
    for (const s of SFX_LIBRARY) {
      expect(SCRIPT_PARSE_SYSTEM, `prompt 缺音效 ${s.id}`).toContain(s.id);
    }
  });

  it("此前永远不会被标注的 6 条新素材现已入 prompt", () => {
    const previouslyMissing = [
      "comedy-boing",
      "comedy-rimshot",
      "comedy-fall-whistle",
      "comedy-scream-fall",
      "suspense-drone",
      "combat-bomb",
    ];
    for (const id of previouslyMissing) {
      expect(SCRIPT_PARSE_SYSTEM, `prompt 仍缺 ${id}`).toContain(id);
    }
  });

  it("保留克制纪律与 offsetSec 说明（prompt 语义未因程序化生成而退化）", () => {
    expect(SCRIPT_PARSE_SYSTEM).toContain("克制纪律");
    expect(SCRIPT_PARSE_SYSTEM).toContain("offsetSec");
    expect(SCRIPT_PARSE_SYSTEM).toContain("宁缺毋滥");
  });
});
