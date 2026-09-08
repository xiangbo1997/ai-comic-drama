import { describe, it, expect } from "vitest";
import { parseLooseJSON, parseLooseJSONArray } from "@/lib/json-repair";

describe("parseLooseJSON", () => {
  it("原生合法 JSON 直通", () => {
    expect(parseLooseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("剥离 ```json 代码围栏", () => {
    expect(parseLooseJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("修复 trailing comma", () => {
    expect(parseLooseJSON('{"a":1,}')).toEqual({ a: 1 });
    expect(parseLooseJSON("[1,2,]")).toEqual([1, 2]);
  });

  it("修复智能引号", () => {
    expect(parseLooseJSON("{“name”:“张三”}")).toEqual({ name: "张三" });
  });

  it("单引号对象转双引号", () => {
    expect(parseLooseJSON("{'a':'b'}")).toEqual({ a: "b" });
  });

  // 撇号回归：双引号字符串内部的 ' 不得被当成单引号字符串的定界符改写。
  // 修复前 {"a":"it's fine"} 会被改成 {"a":"it"s fine"} 而解析失败。
  it("不改写双引号字符串内部的撇号", () => {
    expect(parseLooseJSON(`{"a":"it's fine"}`)).toEqual({ a: "it's fine" });
  });

  it("多个含撇号的值不会互相配对成单引号串", () => {
    expect(parseLooseJSON(`{"a":"it's fine","b":"o'clock"}`)).toEqual({
      a: "it's fine",
      b: "o'clock",
    });
  });

  it("撇号与真正的单引号对象混排时各自处理正确", () => {
    // 前一个字段是合法双引号串（含撇号，不动），后一个是单引号串（需转换）
    expect(parseLooseJSON(`{"a":"it's fine",'b':'x'}`)).toEqual({
      a: "it's fine",
      b: "x",
    });
  });

  it("两次尝试都失败时抛 SyntaxError", () => {
    expect(() => parseLooseJSON("not json at all")).toThrow(SyntaxError);
  });
});

describe("parseLooseJSONArray", () => {
  it("解析对象数组（不被内层花括号截断）", () => {
    expect(parseLooseJSONArray('[{"pair":0,"reason":"连续动作"}]')).toEqual([
      { pair: 0, reason: "连续动作" },
    ]);
  });

  it("解析带代码围栏与前后杂字的数组", () => {
    const raw = '好的，结果如下：\n```json\n[{"key":"客厅"}]\n```\n以上。';
    expect(parseLooseJSONArray(raw)).toEqual([{ key: "客厅" }]);
  });

  it("容忍 trailing comma", () => {
    expect(parseLooseJSONArray('[{"a":1},]')).toEqual([{ a: 1 }]);
  });

  it("空数组", () => {
    expect(parseLooseJSONArray("[]")).toEqual([]);
  });

  it("解析结果不是数组时抛错", () => {
    expect(() => parseLooseJSONArray('{"a":1}')).toThrow(/不是 JSON 数组/);
  });

  it("完全无法解析时抛错", () => {
    expect(() => parseLooseJSONArray("garbage")).toThrow(SyntaxError);
  });
});
