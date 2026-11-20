import { describe, expect, it } from "vitest";
import { script } from "../fixtures/short-video";
import {
  buildCreationPrompt,
  parseScriptInput,
} from "@/lib/short-video/creation";

describe("short video portable creation", () => {
  it("reads plain JSON and a single fenced JSON block in an AI reply", () => {
    const value = JSON.stringify(script);
    expect(parseScriptInput(value)).toEqual(script);
    expect(
      parseScriptInput(`这是脚本：\n\n\`\`\`json\n${value}\n\`\`\`\n请检查。`)
    ).toEqual(script);
    expect(parseScriptInput(`\`\`\`\n${value}\n\`\`\``)).toEqual(script);
  });

  it("does not guess a script from prose or choose between multiple JSON blocks", () => {
    expect(() => parseScriptInput("镜头一：御剑；镜头二：扫地")).toThrow();
    const block = `\`\`\`json\n${JSON.stringify(script)}\n\`\`\``;
    expect(() => parseScriptInput(`${block}\n${block}`)).toThrow();
  });

  it("exports every production field, role reference, timing and full original brief", () => {
    const brief = `${"背景".repeat(700)}最后的来源说明 https://example.test/source`;
    const content = {
      ...script,
      shots: [
        {
          ...script.shots[0],
          dialogue: "师尊，今日御剑？",
          narration: "入门第一天",
        },
      ],
    };
    const result = buildCreationPrompt({
      title: "作品标题",
      brief,
      scriptText: JSON.stringify(content),
    });
    expect(result.ready).toBe(true);
    for (const value of [
      brief,
      "水豚：蓝色工牌",
      "0–15 秒",
      "办公室水豚",
      "推门",
      "师尊，今日御剑？",
      "入门第一天",
      "午休",
      "原创动画",
      JSON.stringify(content, null, 2),
    ])
      expect(result.text).toContain(value);
    expect(result.text).toContain("字幕在剪辑阶段添加");
  });

  it.each([
    "",
    "{",
    JSON.stringify({ ...script, hook: "" }),
    JSON.stringify({ ...script, shots: [null] }),
  ])(
    "exports an honest adaptation request for incomplete input %s",
    (scriptText) => {
      const result = buildCreationPrompt({
        title: "仙门",
        brief: "师尊把扫帚递进画面",
        scriptText,
      });
      expect(result.ready).toBe(false);
      expect(result.text).toContain("待改编");
      expect(result.text).toContain("师尊把扫帚递进画面");
      expect(result.text).toContain("characterKeys");
      expect(result.text).toContain("imagePrompt");
      if (scriptText) expect(result.text).toContain(scriptText);
    }
  );

  it("exports object-only scenes and empty optional sounds and captions explicitly", () => {
    const result = buildCreationPrompt({
      title: "空镜短片",
      brief: "",
      scriptText: JSON.stringify({
        ...script,
        characters: [],
        ending: "",
        suggestedCaption: "",
        hashtags: [],
        shots: [
          {
            ...script.shots[0],
            characterKeys: [],
            dialogue: "",
            narration: "",
            subtitle: "",
          },
        ],
      }),
    });
    expect(result.ready).toBe(true);
    for (const text of [
      "出场角色：无",
      "无固定角色",
      "台词：无",
      "旁白：无",
      "字幕：无",
      "结尾反转：无",
      "发布文案：未填写",
      "未提供",
    ])
      expect(result.text).toContain(text);
  });
});
