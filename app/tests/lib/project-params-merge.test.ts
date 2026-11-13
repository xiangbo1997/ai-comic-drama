import { describe, expect, it } from "vitest";
import { mergeProjectParams } from "@/lib/project-params-merge";

describe("项目配置三方合并", () => {
  it("旧编辑器只改字幕时保留向导新写的审阅态和题材", () => {
    const base = { genre: "悬疑", temperature: 0.5 };
    const current = { ...base, producerReview: { createdByProducer: true } };
    expect(
      mergeProjectParams(current, base, { ...base, temperature: 0.8 })
    ).toEqual({
      value: { ...current, temperature: 0.8 },
      conflicts: [],
    });
  });
  it("同一字段并发更改提示冲突而不是静默覆盖", () => {
    expect(
      mergeProjectParams(
        { genre: "都市" },
        { genre: "悬疑" },
        { genre: "喜剧" }
      )
    ).toEqual({ conflicts: ["genre"] });
  });
  it("保留用户明确删除字段的语义与其他客户端新增字段", () => {
    expect(
      mergeProjectParams(
        { genre: "悬疑", temperature: 0.5 },
        { genre: "悬疑" },
        {}
      )
    ).toEqual({
      value: { temperature: 0.5 },
      conflicts: [],
    });
  });
  it("并发写入相同值可安全重试，JSON对象键顺序不产生假冲突", () => {
    expect(
      mergeProjectParams(
        { subtitleStyle: { size: 20, color: "red" } },
        {},
        { subtitleStyle: { color: "red", size: 20 } }
      ).conflicts
    ).toEqual([]);
  });
  it("数组顺序变化属于真正变更", () => {
    expect(
      mergeProjectParams(
        { emphasis: ["a", "b"] },
        { emphasis: ["a"] },
        { emphasis: ["b", "a"] }
      ).conflicts
    ).toEqual(["emphasis"]);
  });
});
