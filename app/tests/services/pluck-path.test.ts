import { describe, it, expect } from "vitest";
import { pluckPath } from "@/services/ai/providers/base";

describe("pluckPath", () => {
  it("正常路径取值与裸下标等价", () => {
    const openaiResp = { choices: [{ message: { content: "hello" } }] };
    expect(
      pluckPath(openaiResp, ["choices", 0, "message", "content"], "LLM 响应")
    ).toBe("hello");
  });

  it("深层嵌套（Gemini 四层）正确取值", () => {
    const geminiResp = {
      candidates: [{ content: { parts: [{ text: "world" }] } }],
    };
    expect(
      pluckPath(
        geminiResp,
        ["candidates", 0, "content", "parts", 0, "text"],
        "Gemini 响应"
      )
    ).toBe("world");
  });

  it("中途某层缺失时抛可读错误而非 TypeError", () => {
    // 模拟内容安全过滤：candidates 为空数组
    const blocked = { candidates: [] };
    expect(() =>
      pluckPath(
        blocked,
        ["candidates", 0, "content", "parts", 0, "text"],
        "Gemini 响应"
      )
    ).toThrow(/Gemini 响应/);
  });

  it("上游返回错误对象（无目标字段）时报错含业务标签", () => {
    const errorObj = { error: { message: "quota exceeded" } };
    expect(() =>
      pluckPath(errorObj, ["choices", 0, "message", "content"], "LLM 响应")
    ).toThrow(/LLM 响应/);
  });

  it("值恰好为 null 时命中该值（区别于缺失）", () => {
    const resp = { data: { field: null } };
    // 命中 field 层（对象存在）→ 继续取 field 得到 null，视为已命中
    expect(pluckPath(resp, ["data", "field"], "测试")).toBeNull();
  });

  it("末端 undefined 视为缺失并报错", () => {
    const resp = { data: {} };
    expect(() => pluckPath(resp, ["data", "missing"], "测试")).toThrow(
      /缺少字段/
    );
  });
});
