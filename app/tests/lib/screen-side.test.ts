import { describe, expect, it } from "vitest";

import { buildScreenSidePhrases } from "@/lib/prompt-builder";
import { SceneScriptZ } from "@/services/agents/schemas";
import { SCRIPT_PARSE_SYSTEM } from "@/lib/prompts/script-parse";
import { SCRIPT_PARSER_SYSTEM } from "@/lib/prompts/agent-prompts/script-parser";

/**
 * 180 度轴线数据链契约。
 *
 * 背景：全库此前没有任何轴线概念——LLM 每镜独立描述「某某在画面左侧」，
 * 无机制保证跨镜一致，结果 A 和 B 每两三镜就左右互换、视线对不上
 * （两人都看向画面右边，像各自对着空气说话）。对话戏是漫剧的绝对主体，
 * 这在真人剪辑里是明确事故，在漫剧里观众说不出为什么，只会觉得「看着晕」。
 *
 * 链路：解析 prompt 要求 screenSide → Zod 承接 → 落库 → 出图 prompt 翻成英文构图短语。
 * 缺最后一环则「校验出越轴也修不了」。
 */

const BASE_SCENE = {
  id: 1,
  shotType: "近景",
  description: "两人在会议室隔着长桌对视，林萧在左，陆沉在右",
  characters: ["林萧", "陆沉"],
  dialogue: "你确定要这么做？",
  narration: null,
  emotion: "angry",
  duration: 3,
  locationKey: "会议室",
};

describe("buildScreenSidePhrases", () => {
  it("left 面向右、right 面向左——两人视线才能对上", () => {
    const phrases = buildScreenSidePhrases({ 林萧: "left", 陆沉: "right" });
    expect(phrases).toContain("林萧 on the left side of frame, facing right");
    expect(phrases).toContain("陆沉 on the right side of frame, facing left");
  });

  it("两人及以上补轴线一致性声明", () => {
    const phrases = buildScreenSidePhrases({ 林萧: "left", 陆沉: "right" });
    expect(phrases).toContain("consistent 180-degree axis");
    expect(phrases).toContain("eyelines matched");
  });

  it("单人只给位置，不加轴线说明（单人镜无轴线可言）", () => {
    const phrases = buildScreenSidePhrases({ 林萧: "center" });
    expect(phrases).toContain("林萧 centered in frame");
    expect(phrases).not.toContain("180-degree axis");
  });

  it("无数据 / 空对象返回 null，不注入噪音", () => {
    expect(buildScreenSidePhrases(undefined)).toBeNull();
    expect(buildScreenSidePhrases(null)).toBeNull();
    expect(buildScreenSidePhrases({})).toBeNull();
  });

  it("非法值被过滤，不产出残缺短语", () => {
    const phrases = buildScreenSidePhrases({ 林萧: "left", 路人: "上面" });
    expect(phrases).toContain("林萧");
    expect(phrases).not.toContain("路人");
  });
});

describe("SceneScriptZ 承接 screenSide", () => {
  it("合法站位被保留", () => {
    const parsed = SceneScriptZ.parse({
      ...BASE_SCENE,
      screenSide: { 林萧: "left", 陆沉: "right" },
    });
    expect(parsed.screenSide).toEqual({ 林萧: "left", 陆沉: "right" });
  });

  it("缺省时为 undefined——单人镜/存量数据零回归", () => {
    const parsed = SceneScriptZ.parse(BASE_SCENE);
    expect(parsed.screenSide).toBeUndefined();
  });

  it("非法值整体降级为 undefined 而非抛错——站位是增强项不该阻断解析", () => {
    const parsed = SceneScriptZ.parse({
      ...BASE_SCENE,
      screenSide: { 林萧: "diagonal" },
    });
    expect(parsed.screenSide).toBeUndefined();
  });
});

describe("两条解析路径都下发轴线纪律", () => {
  it.each([
    ["服务层直连解析", SCRIPT_PARSE_SYSTEM],
    ["Agent 解析路径", SCRIPT_PARSER_SYSTEM],
  ])("%s 含 screenSide 与 180 度轴线要求", (_name, prompt) => {
    expect(prompt).toContain("screenSide");
    expect(prompt).toContain("180 度轴线");
    // 作用域跟随 locationKey：换地点即新的一场戏可重新定轴
    expect(prompt).toContain("locationKey");
    // 唯一例外必须写明，否则 LLM 会随意翻转
    expect(prompt).toContain("走位");
  });
});
