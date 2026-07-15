import { describe, it, expect } from "vitest";
import {
  matchCharacterByName,
  resolveSelectedCharacterId,
} from "@/services/agents/match-scene-character";

const chars = [
  { id: "c1", name: "林烬" },
  { id: "c2", name: "苏离" },
  { id: "c3", name: "阿德" },
];

describe("matchCharacterByName（C3：与手动路径同语义）", () => {
  it("精确匹配（忽略大小写）", () => {
    expect(matchCharacterByName(chars, "林烬")).toBe("c1");
    expect(matchCharacterByName([{ id: "x", name: "Alice" }], "alice")).toBe(
      "x"
    );
  });

  it("模糊匹配：角色名包含输入", () => {
    expect(matchCharacterByName([{ id: "c1", name: "林烬阁下" }], "林烬")).toBe(
      "c1"
    );
  });

  it("反向模糊：输入包含角色名", () => {
    expect(matchCharacterByName(chars, "林烬大人")).toBe("c1");
  });

  it("空名 / 无命中返回 null", () => {
    expect(matchCharacterByName(chars, "")).toBeNull();
    expect(matchCharacterByName(chars, "  ")).toBeNull();
    expect(matchCharacterByName(chars, "陌生人")).toBeNull();
  });

  it("优先级：精确 > 角色名含输入 > 输入含角色名", () => {
    const list = [
      { id: "loose", name: "林" }, // 反向模糊会命中"林烬"含"林"
      { id: "exact", name: "林烬" }, // 精确
    ];
    expect(matchCharacterByName(list, "林烬")).toBe("exact");
  });
});

describe("resolveSelectedCharacterId（C3：取首个命中）", () => {
  it("按名单顺序取首个命中角色 id", () => {
    expect(resolveSelectedCharacterId(chars, ["陌生人", "苏离", "林烬"])).toBe(
      "c2"
    );
  });

  it("名单为空 / null / undefined 返回 null", () => {
    expect(resolveSelectedCharacterId(chars, [])).toBeNull();
    expect(resolveSelectedCharacterId(chars, null)).toBeNull();
    expect(resolveSelectedCharacterId(chars, undefined)).toBeNull();
  });

  it("名单全部未命中返回 null", () => {
    expect(resolveSelectedCharacterId(chars, ["路人甲", "路人乙"])).toBeNull();
  });

  it("项目无角色时返回 null", () => {
    expect(resolveSelectedCharacterId([], ["林烬"])).toBeNull();
  });
});
