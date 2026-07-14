import { describe, it, expect } from "vitest";
import { matchCharacterByName } from "@/lib/producer-client";

describe("matchCharacterByName（制片人向导角色查重）", () => {
  const list = [
    { id: "a", name: "林烬" },
    { id: "b", name: "苏晚" },
  ];

  it("精确同名命中，返回对应角色", () => {
    expect(matchCharacterByName(list, "苏晚")).toEqual({
      id: "b",
      name: "苏晚",
    });
  });

  it("前后空白无关（trim 后比较）", () => {
    expect(matchCharacterByName(list, "  林烬 ")).toEqual({
      id: "a",
      name: "林烬",
    });
    expect(matchCharacterByName([{ id: "c", name: " 陈默 " }], "陈默")).toEqual(
      {
        id: "c",
        name: " 陈默 ",
      }
    );
  });

  it("仅前缀/包含关系不算命中（防 contains 误伤）", () => {
    expect(matchCharacterByName([{ id: "d", name: "林烬阁下" }], "林烬")).toBe(
      null
    );
  });

  it("无同名 → null", () => {
    expect(matchCharacterByName(list, "王五")).toBe(null);
  });

  it("非数组输入（GET 失败降级）安全返回 null", () => {
    expect(matchCharacterByName(null, "林烬")).toBe(null);
    expect(matchCharacterByName(undefined, "林烬")).toBe(null);
    expect(matchCharacterByName({ error: "boom" }, "林烬")).toBe(null);
  });

  it("成员缺 name 字段不抛错", () => {
    expect(
      matchCharacterByName([{ id: "e" }, { id: "f", name: "赵六" }], "赵六")
    ).toEqual({ id: "f", name: "赵六" });
  });
});
