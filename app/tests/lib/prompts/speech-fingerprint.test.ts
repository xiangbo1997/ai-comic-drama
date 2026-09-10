import { describe, expect, it } from "vitest";

import { buildStoryboardPrompt } from "@/lib/prompts/agent-prompts/storyboard";
import { DRAMA_SCRIPT_SYSTEM } from "@/lib/prompts/agent-prompts/drama-script";
import { CHARACTER_BIBLE_SYSTEM } from "@/lib/prompts/agent-prompts/character-bible";

/**
 * 对白差异化数据链契约。
 *
 * 背景：角色圣经原本 11 个字段全是外貌，写对白的环节拿不到「这个角色怎么说话」，
 * 结果全剧所有人一套中性书面语——而「配音情感不足」是近半数用户的弃剧归因
 * （见 genre-matrix.ts 引用的艾媒调研）。
 *
 * 链路：character-bible 产出 speechFingerprint → storyboard prompt 注入 →
 * 分镜层调整对白时保持声口差异。任一环断掉，字段就是死的。
 */

const SCENES = [
  {
    id: 1,
    shotType: "近景",
    description: "两人在会议室对视",
    characters: ["林晚"],
    dialogue: "你确定要这么做？",
    narration: null,
    emotion: "紧张",
    duration: 3,
  },
];

describe("语言指纹注入分镜 prompt", () => {
  it("圣经带指纹时，prompt 含差异化块与各角色声口", () => {
    const prompt = buildStoryboardPrompt(SCENES, [
      {
        name: "林晚",
        canonicalPrompt: "1girl, long black hair",
        appearance: {},
        speechFingerprint: {
          register: "留洋归国，用词偏书面",
          sentenceStyle: "长句反问",
          verbalTic: "有意思",
          taboo: "绝不说脏字",
        },
      },
    ]);

    expect(prompt).toContain("对白差异化（遮名可辨）");
    expect(prompt).toContain("林晚");
    expect(prompt).toContain("留洋归国，用词偏书面");
    expect(prompt).toContain("长句反问");
    expect(prompt).toContain("有意思");
    expect(prompt).toContain("绝不说脏字");
  });

  it("圣经无指纹时整块省略——存量项目零回归", () => {
    const prompt = buildStoryboardPrompt(SCENES, [
      {
        name: "林晚",
        canonicalPrompt: "1girl, long black hair",
        appearance: {},
      },
    ]);

    expect(prompt).not.toContain("对白差异化");
    // 角色标准提示词仍在，说明只是少了增强块，主链路未受影响
    expect(prompt).toContain("林晚");
  });

  it("指纹部分缺省时只渲染已填字段，不产出空标签", () => {
    const prompt = buildStoryboardPrompt(SCENES, [
      {
        name: "老陈",
        canonicalPrompt: "1man, short hair",
        appearance: {},
        speechFingerprint: { register: "市井口语，爱用歇后语" },
      },
    ]);

    expect(prompt).toContain("市井口语，爱用歇后语");
    expect(prompt).not.toContain("句式：");
    expect(prompt).not.toContain("口头禅：");
  });

  it("指纹对象存在但字段全空时不注入该角色行", () => {
    const prompt = buildStoryboardPrompt(SCENES, [
      {
        name: "路人",
        canonicalPrompt: "1man, plain",
        appearance: {},
        speechFingerprint: {},
      },
    ]);

    expect(prompt).not.toContain("对白差异化");
  });
});

describe("对白差异化规则注入源头", () => {
  it("圣经 prompt 要求产出语言指纹与戏剧功能", () => {
    expect(CHARACTER_BIBLE_SYSTEM).toContain("语言指纹");
    expect(CHARACTER_BIBLE_SYSTEM).toContain("戏剧功能");
    // 反派动机成立是硬约束——防「因为他是反派所以他要害人」
    expect(CHARACTER_BIBLE_SYSTEM).toContain("自身逻辑成立");
  });

  it("创作路径 prompt 含遮名可辨与潜台词规则", () => {
    expect(DRAMA_SCRIPT_SYSTEM).toContain("遮名可辨");
    expect(DRAMA_SCRIPT_SYSTEM).toContain("潜台词优先");
    expect(DRAMA_SCRIPT_SYSTEM).toContain("中性书面语");
  });
});
