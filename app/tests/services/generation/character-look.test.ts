import { describe, it, expect } from "vitest";
import {
  matchClothingPreset,
  normalizeOutfitKey,
  type LookClothingPreset,
} from "@/services/generation/character-look-match";
import {
  parseOutfitEntries,
  matchOutfitToCharacter,
} from "@/services/generation/scene-looks-match";
import type { SceneCharacterInfo } from "@/services/generation/types";

/**
 * 场景定妆照（换装变体）的纯逻辑单测：
 * - matchClothingPreset：outfit↔preset 模糊匹配（全等/互相包含/大小写空白）
 * - normalizeOutfitKey：缓存键规整
 * - parseOutfitEntries：Scene.characterOutfits（unknown Json）安全解析
 * - matchOutfitToCharacter：换装标注按角色名匹配本镜角色
 */

describe("normalizeOutfitKey — 换装缓存键规整", () => {
  it("trim + 折叠空白 + 小写", () => {
    expect(normalizeOutfitKey("  白色  婚纱 ")).toBe("白色 婚纱");
    expect(normalizeOutfitKey("Red Dress")).toBe("red dress");
  });

  it("同套衣服的大小写/多空格差异归一到同一 key", () => {
    expect(normalizeOutfitKey("战损 铠甲")).toBe(
      normalizeOutfitKey("  战损   铠甲  ")
    );
  });
});

describe("matchClothingPreset — 用户预设服装模糊匹配", () => {
  const presets: LookClothingPreset[] = [
    {
      name: "婚纱",
      description: "白色齐地婚纱",
      imageRef: "https://x/wed.jpg",
    },
    { name: "校服", description: "深蓝西装校服" },
  ];

  it("全等命中", () => {
    expect(matchClothingPreset(presets, "婚纱")?.name).toBe("婚纱");
  });

  it("outfit 含预设 name（互相包含）命中", () => {
    expect(matchClothingPreset(presets, "白色婚纱")?.name).toBe("婚纱");
  });

  it("预设 name 含 outfit 命中", () => {
    expect(matchClothingPreset(presets, "校")?.name).toBe("校服");
  });

  it("忽略首尾空白与大小写", () => {
    const en: LookClothingPreset[] = [{ name: "Wedding Dress" }];
    expect(matchClothingPreset(en, "  wedding dress ")?.name).toBe(
      "Wedding Dress"
    );
  });

  it("无匹配返回 null", () => {
    expect(matchClothingPreset(presets, "睡衣")).toBeNull();
  });

  it("空/缺省预设返回 null", () => {
    expect(matchClothingPreset(null, "婚纱")).toBeNull();
    expect(matchClothingPreset([], "婚纱")).toBeNull();
    expect(matchClothingPreset(undefined, "婚纱")).toBeNull();
  });

  it("空 outfit 返回 null", () => {
    expect(matchClothingPreset(presets, "  ")).toBeNull();
  });
});

describe("parseOutfitEntries — Scene.characterOutfits 安全解析", () => {
  it("解析合法数组", () => {
    expect(parseOutfitEntries([{ name: "林萧", outfit: "白色婚纱" }])).toEqual([
      { name: "林萧", outfit: "白色婚纱" },
    ]);
  });

  it("过滤 name/outfit 任一为空的条目", () => {
    expect(
      parseOutfitEntries([
        { name: "林萧", outfit: "白色婚纱" },
        { name: "", outfit: "黑西装" },
        { name: "路人", outfit: "  " },
        { name: "  ", outfit: "  " },
      ])
    ).toEqual([{ name: "林萧", outfit: "白色婚纱" }]);
  });

  it("trim name/outfit", () => {
    expect(
      parseOutfitEntries([{ name: "  林萧 ", outfit: " 白色婚纱  " }])
    ).toEqual([{ name: "林萧", outfit: "白色婚纱" }]);
  });

  it("非数组 / null / 异常元素返回空数组或过滤", () => {
    expect(parseOutfitEntries(null)).toEqual([]);
    expect(parseOutfitEntries("白色婚纱")).toEqual([]);
    expect(parseOutfitEntries(undefined)).toEqual([]);
    expect(parseOutfitEntries([null, 42, "x"])).toEqual([]);
  });
});

describe("matchOutfitToCharacter — 换装标注按角色名匹配本镜角色", () => {
  const chars: SceneCharacterInfo[] = [
    { id: "c1", name: "林萧", role: "primary" },
    { id: "c2", name: " 顾北 ", role: "secondary" },
  ];

  it("全等命中", () => {
    expect(matchOutfitToCharacter(chars, "林萧")?.id).toBe("c1");
  });

  it("宽松 trim 后全等命中（角色名带空白）", () => {
    expect(matchOutfitToCharacter(chars, "顾北")?.id).toBe("c2");
  });

  it("标注名带空白也能匹配", () => {
    expect(matchOutfitToCharacter(chars, "  林萧 ")?.id).toBe("c1");
  });

  it("无匹配返回 null", () => {
    expect(matchOutfitToCharacter(chars, "陌生人")).toBeNull();
  });

  it("空名返回 null", () => {
    expect(matchOutfitToCharacter(chars, "  ")).toBeNull();
  });
});
