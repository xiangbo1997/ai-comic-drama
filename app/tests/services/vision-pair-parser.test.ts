import { describe, it, expect } from "vitest";
import {
  parsePairIssues,
  buildComparePrompt,
  type ComparePairArgs,
} from "@/services/agents/vision-reviewer";
import type { AIServiceConfig } from "@/types";

describe("parsePairIssues · VLM 相邻镜问题解析", () => {
  it("合法 JSON → 结构化问题清单", () => {
    const raw =
      '{"issues":[{"dimension":"角色服装","severity":"严重","description":"上衣从白变红","fixNote":"改回白色上衣"}]}';
    const out = parsePairIssues(raw);
    expect(out).toEqual([
      {
        dimension: "角色服装",
        severity: "严重",
        description: "上衣从白变红",
        fixNote: "改回白色上衣",
      },
    ]);
  });

  it("容忍代码围栏 / 前后杂字", () => {
    const raw =
      '分析如下：\n```json\n{"issues":[{"dimension":"光线","severity":"中等","description":"光向翻转","fixNote":"统一为左侧光"}]}\n```';
    const out = parsePairIssues(raw);
    expect(out).toHaveLength(1);
    expect(out?.[0].dimension).toBe("光线");
  });

  it("空 issues 数组 → 返回 []（此对无问题，非跳过）", () => {
    expect(parsePairIssues('{"issues":[]}')).toEqual([]);
  });

  it("找不到 JSON → 返回 null（调用方记为跳过）", () => {
    expect(parsePairIssues("抱歉我无法比较这两张图")).toBeNull();
  });

  it("非法 JSON 语法 → 返回 null", () => {
    expect(parsePairIssues('{"issues":[}')).toBeNull();
  });

  it("issues 非数组 → 返回 null", () => {
    expect(parsePairIssues('{"issues":"oops"}')).toBeNull();
  });

  it("非法维度条目丢弃，合法条目保留", () => {
    const raw =
      '{"issues":[{"dimension":"表情","severity":"严重","description":"x","fixNote":"y"},{"dimension":"发型","severity":"轻微","description":"刘海变短","fixNote":"加长刘海"}]}';
    const out = parsePairIssues(raw);
    expect(out).toEqual([
      {
        dimension: "发型",
        severity: "轻微",
        description: "刘海变短",
        fixNote: "加长刘海",
      },
    ]);
  });

  it("非法严重度条目丢弃", () => {
    const raw =
      '{"issues":[{"dimension":"色调","severity":"致命","description":"x","fixNote":"y"}]}';
    expect(parsePairIssues(raw)).toEqual([]);
  });

  it("缺 description 或 fixNote 的条目丢弃", () => {
    const raw =
      '{"issues":[{"dimension":"色调","severity":"中等","description":"偏冷","fixNote":""},{"dimension":"色调","severity":"中等","fixNote":"调暖"}]}';
    expect(parsePairIssues(raw)).toEqual([]);
  });

  it("超长 description / fixNote 被截断", () => {
    const longDesc = "很".repeat(100);
    const longNote = "改".repeat(80);
    const raw = `{"issues":[{"dimension":"环境背景","severity":"中等","description":"${longDesc}","fixNote":"${longNote}"}]}`;
    const out = parsePairIssues(raw);
    expect(out?.[0].description.length).toBe(60);
    expect(out?.[0].fixNote.length).toBe(40);
  });
});

describe("buildComparePrompt · 剧情意图上下文", () => {
  const llmConfig: AIServiceConfig = {
    protocol: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o",
  };

  function baseArgs(extra: Partial<ComparePairArgs> = {}): ComparePairArgs {
    return {
      prevImageUrl: "https://img/prev.png",
      nextImageUrl: "https://img/next.png",
      prevOrder: 1,
      nextOrder: 2,
      llmConfig,
      ...extra,
    };
  }

  it("有画面描述 + 换装标注 → 拼入剧情设定 / 换装标注（含前后镜）", () => {
    const longDesc = "描".repeat(200);
    const prompt = buildComparePrompt(
      baseArgs({
        prevDescription: "雨夜的巷口",
        nextDescription: longDesc,
        prevOutfitNotes: ["林悦：风衣"],
        nextOutfitNotes: ["林悦：晚礼服"],
      })
    );
    expect(prompt).toContain("剧情设定");
    expect(prompt).toContain("前镜描述：雨夜的巷口");
    // 后镜描述被截断到 150 字
    expect(prompt).toContain(`后镜描述：${"描".repeat(150)}`);
    expect(prompt).not.toContain("描".repeat(151));
    expect(prompt).toContain("换装标注");
    expect(prompt).toContain("前镜 林悦：风衣");
    expect(prompt).toContain("后镜 林悦：晚礼服");
  });

  it("无任何剧情意图数据 → 既不含剧情设定也不含换装标注", () => {
    const prompt = buildComparePrompt(baseArgs());
    expect(prompt).not.toContain("剧情设定");
    expect(prompt).not.toContain("换装标注");
  });
});
