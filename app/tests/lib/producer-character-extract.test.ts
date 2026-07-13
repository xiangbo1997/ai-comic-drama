import { describe, it, expect } from "vitest";
import {
  extractProducerCharacterNames,
  MAX_PRODUCER_CHARACTERS,
} from "@/lib/producer-character-extract";
import type { DramaSceneScript } from "@/types/drama";

/** 造一个最小 scene（只填抽取用到的字段） */
function scene(dialogue: string | null): DramaSceneScript {
  return {
    index: 1,
    title: "场景",
    description: "描述",
    dialogue,
    narration: null,
    emotion: "neutral",
    durationSec: 5,
  };
}

describe("extractProducerCharacterNames", () => {
  it("主角人名从 protagonist 抽出且排第一", () => {
    const names = extractProducerCharacterNames({
      protagonist: "林烬，被家族背叛的天才炼丹师",
      scenes: [scene("苏晚：你终于来了")],
    });
    expect(names[0]).toBe("林烬");
    expect(names).toContain("苏晚");
  });

  it("对白说话人去重（同名多次只留一个）", () => {
    const names = extractProducerCharacterNames({
      protagonist: "",
      scenes: [scene("苏晚：第一句\n苏晚：第二句"), scene("陈默：另一个人")],
    });
    expect(names).toEqual(["苏晚", "陈默"]);
  });

  it("忽略旁白 / 独白 / 画外音 / OS 等非角色标记", () => {
    const names = extractProducerCharacterNames({
      protagonist: null,
      scenes: [
        scene("旁白：多年以后"),
        scene("画外音：远处传来声音"),
        scene("内心独白：他在想什么"),
        scene("OS：字幕提示"),
        scene("林烬：真正的台词"),
      ],
    });
    expect(names).toEqual(["林烬"]);
  });

  it("过滤非法名（英文缩写 / 过长句 / 单字）", () => {
    const names = extractProducerCharacterNames({
      protagonist: null,
      scenes: [
        scene("A：太短"),
        scene("这是一句超过八个字的长台词不该当名字：内容"),
        scene("张三：合法"),
      ],
    });
    expect(names).toEqual(["张三"]);
  });

  it("上限 6 个（成本护栏）", () => {
    const dialogues = [
      "甲一",
      "乙二",
      "丙三",
      "丁四",
      "戊五",
      "己六",
      "庚七",
      "辛八",
    ].map((n) => scene(`${n}：台词`));
    const names = extractProducerCharacterNames({
      protagonist: "主角某人",
      scenes: dialogues,
    });
    expect(names.length).toBe(MAX_PRODUCER_CHARACTERS);
    expect(names[0]).toBe("主角某人");
  });

  it("空脚本 / 无对白 → 空数组", () => {
    expect(
      extractProducerCharacterNames({ protagonist: "", scenes: [] })
    ).toEqual([]);
    expect(
      extractProducerCharacterNames({
        protagonist: null,
        scenes: [scene(null), scene("没有冒号的纯叙述")],
      })
    ).toEqual([]);
  });

  it("主角与对白说话人重名 → 只出现一次且在首位", () => {
    const names = extractProducerCharacterNames({
      protagonist: "林烬，主角",
      scenes: [scene("林烬：自己说话\n苏晚：配角")],
    });
    expect(names).toEqual(["林烬", "苏晚"]);
  });
});
