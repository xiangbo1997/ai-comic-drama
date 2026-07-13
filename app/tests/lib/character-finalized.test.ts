import { describe, it, expect } from "vitest";
import {
  isCharacterFinalized,
  collectUnfinalizedCharacterNames,
} from "@/lib/character-finalized";

describe("isCharacterFinalized", () => {
  it("canonicalImageUrl 非空 → 已定稿", () => {
    expect(
      isCharacterFinalized({ canonicalImageUrl: "https://x/a.webp" })
    ).toBe(true);
  });

  it("canonicalImageUrl 为空 / null / undefined / 空白 → 未定稿", () => {
    expect(isCharacterFinalized({ canonicalImageUrl: "" })).toBe(false);
    expect(isCharacterFinalized({ canonicalImageUrl: null })).toBe(false);
    expect(isCharacterFinalized({ canonicalImageUrl: undefined })).toBe(false);
    expect(isCharacterFinalized({ canonicalImageUrl: "   " })).toBe(false);
    expect(isCharacterFinalized({})).toBe(false);
    expect(isCharacterFinalized(null)).toBe(false);
    expect(isCharacterFinalized(undefined)).toBe(false);
  });
});

describe("collectUnfinalizedCharacterNames", () => {
  it("挑出未定稿角色名，保持顺序", () => {
    const chars = [
      { character: { name: "林烬", canonicalImageUrl: "u" } },
      { character: { name: "苏晚", canonicalImageUrl: null } },
      { character: { name: "陈默", canonicalImageUrl: "" } },
    ];
    expect(collectUnfinalizedCharacterNames(chars)).toEqual(["苏晚", "陈默"]);
  });

  it("全部已定稿 → 空数组（不打扰）", () => {
    const chars = [
      { character: { name: "A", canonicalImageUrl: "u1" } },
      { character: { name: "B", canonicalImageUrl: "u2" } },
    ];
    expect(collectUnfinalizedCharacterNames(chars)).toEqual([]);
  });

  it("空 / undefined → 空数组", () => {
    expect(collectUnfinalizedCharacterNames([])).toEqual([]);
    expect(collectUnfinalizedCharacterNames(undefined)).toEqual([]);
  });

  it("同名未定稿去重", () => {
    const chars = [
      { character: { name: "同名", canonicalImageUrl: null } },
      { character: { name: "同名", canonicalImageUrl: undefined } },
    ];
    expect(collectUnfinalizedCharacterNames(chars)).toEqual(["同名"]);
  });
});
