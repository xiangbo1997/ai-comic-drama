/**
 * 场景角色身份上下文单测（从 workflow-engine 提取的纯函数）
 *
 * 覆盖两条数据链不变量：
 *  - 参考图按 sceneArtifact.characters 的顺序取（第一个 = primary），
 *    canonical 资产优先、旧 referenceImages 回退、最多 3 张
 *  - identitySeed 由主角色 DB id 决定，必须稳定/确定/落在 [0, 2^31-1)
 */

import { describe, it, expect } from "vitest";
import {
  buildSceneCharacterContext,
  identitySeedFromCharacterId,
  type SceneCharacterEntry,
  type ProjectCharacterMap,
} from "@/services/agents/scene-character-context";
import type { CharacterBible, SceneArtifact } from "@/services/agents/types";

/** 造一个只含被测函数关心字段的角色记录 */
function makeChar(
  id: string,
  name: string,
  opts?: { canonical?: string[]; legacy?: string[] }
): SceneCharacterEntry {
  return {
    id,
    name,
    referenceImages: opts?.legacy ?? [],
    referenceAssets: (opts?.canonical ?? []).map((url) => ({ url })),
  };
}

function makeMap(chars: SceneCharacterEntry[]): ProjectCharacterMap {
  return new Map(chars.map((c) => [c.name, c]));
}

/** 只填被测函数读到的字段，其余按 SceneArtifact 可选处理 */
function makeScene(characters: string[]): SceneArtifact {
  return { characters } as SceneArtifact;
}

function makeBible(
  entries: { name: string; canonicalPrompt?: string }[]
): CharacterBible {
  return { characters: entries } as CharacterBible;
}

describe("identitySeedFromCharacterId", () => {
  it("同一 id 恒得同一 seed（确定性）", () => {
    const a = identitySeedFromCharacterId("clx123abc");
    const b = identitySeedFromCharacterId("clx123abc");
    expect(a).toBe(b);
  });

  it("不同 id 得到不同 seed", () => {
    expect(identitySeedFromCharacterId("char-a")).not.toBe(
      identitySeedFromCharacterId("char-b")
    );
  });

  it("seed 落在 [0, 2^31-1) 且为整数", () => {
    const ids = [
      "",
      "a",
      "clx0000000000000000000000",
      "角色-中文-id",
      "x".repeat(200),
      "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
    ];
    for (const id of ids) {
      const seed = identitySeedFromCharacterId(id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(0x7fffffff);
    }
  });

  it("空字符串返回 FNV-1a 偏移基数取模后的固定值", () => {
    // 0x811c9dc5 >>> 0 = 2166136261; 2166136261 % 0x7fffffff = 18652614
    expect(identitySeedFromCharacterId("")).toBe(18652614);
  });
});

describe("buildSceneCharacterContext — 参考图收集", () => {
  it("无角色时返回空参考图、无 prompt、无 seed", () => {
    const ctx = buildSceneCharacterContext(
      makeScene([]),
      makeMap([]),
      undefined
    );
    expect(ctx).toEqual({ referenceImages: [] });
  });

  it("characters 字段缺失时同样安全返回空", () => {
    const ctx = buildSceneCharacterContext(
      {} as SceneArtifact,
      makeMap([makeChar("c1", "阿离", { canonical: ["u1.jpg"] })]),
      undefined
    );
    expect(ctx.referenceImages).toEqual([]);
    expect(ctx.seed).toBeUndefined();
  });

  it("多角色按 sceneArtifact.characters 的顺序取图（primary 在前）", () => {
    const map = makeMap([
      makeChar("c1", "阿离", { canonical: ["li.jpg"] }),
      makeChar("c2", "萧然", { canonical: ["xiao.jpg"] }),
      makeChar("c3", "陆吾", { canonical: ["lu.jpg"] }),
    ]);
    const ctx = buildSceneCharacterContext(
      makeScene(["萧然", "陆吾", "阿离"]),
      map,
      undefined
    );
    expect(ctx.referenceImages).toEqual(["xiao.jpg", "lu.jpg", "li.jpg"]);
    // seed 跟随第一个角色（萧然 = c2）
    expect(ctx.seed).toBe(identitySeedFromCharacterId("c2"));
  });

  it("canonical 资产优先于旧 referenceImages", () => {
    const map = makeMap([
      makeChar("c1", "阿离", {
        canonical: ["canonical.jpg"],
        legacy: ["legacy.jpg"],
      }),
    ]);
    const ctx = buildSceneCharacterContext(makeScene(["阿离"]), map, undefined);
    expect(ctx.referenceImages).toEqual(["canonical.jpg"]);
  });

  it("无 canonical 资产时回退到 referenceImages[0]", () => {
    const map = makeMap([
      makeChar("c1", "阿离", { legacy: ["legacy1.jpg", "legacy2.jpg"] }),
    ]);
    const ctx = buildSceneCharacterContext(makeScene(["阿离"]), map, undefined);
    expect(ctx.referenceImages).toEqual(["legacy1.jpg"]);
  });

  it("两种参考图都没有的角色不贡献图，但仍参与排序与 seed", () => {
    const map = makeMap([
      makeChar("c1", "无图", {}),
      makeChar("c2", "有图", { canonical: ["has.jpg"] }),
    ]);
    const ctx = buildSceneCharacterContext(
      makeScene(["无图", "有图"]),
      map,
      undefined
    );
    expect(ctx.referenceImages).toEqual(["has.jpg"]);
    // seed 仍取第一个角色（无图 = c1）
    expect(ctx.seed).toBe(identitySeedFromCharacterId("c1"));
  });

  it("参考图最多 3 张（第 4 个角色被截断）", () => {
    const map = makeMap([
      makeChar("c1", "A", { canonical: ["a.jpg"] }),
      makeChar("c2", "B", { canonical: ["b.jpg"] }),
      makeChar("c3", "C", { canonical: ["c.jpg"] }),
      makeChar("c4", "D", { canonical: ["d.jpg"] }),
    ]);
    const ctx = buildSceneCharacterContext(
      makeScene(["A", "B", "C", "D"]),
      map,
      undefined
    );
    expect(ctx.referenceImages).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("查表命中不到的角色名被静默跳过", () => {
    const map = makeMap([makeChar("c1", "阿离", { canonical: ["li.jpg"] })]);
    const ctx = buildSceneCharacterContext(
      makeScene(["查无此人", "阿离"]),
      map,
      undefined
    );
    expect(ctx.referenceImages).toEqual(["li.jpg"]);
    // 未命中的名字不参与排序，主角色变成阿离
    expect(ctx.seed).toBe(identitySeedFromCharacterId("c1"));
  });

  it("全部角色名都查不到时无 seed", () => {
    const ctx = buildSceneCharacterContext(
      makeScene(["幽灵甲", "幽灵乙"]),
      makeMap([makeChar("c1", "阿离")]),
      undefined
    );
    expect(ctx.referenceImages).toEqual([]);
    expect(ctx.seed).toBeUndefined();
  });

  it("同一角色重复出现时按出现次数各取一次图（不去重）", () => {
    const map = makeMap([makeChar("c1", "阿离", { canonical: ["li.jpg"] })]);
    const ctx = buildSceneCharacterContext(
      makeScene(["阿离", "阿离"]),
      map,
      undefined
    );
    expect(ctx.referenceImages).toEqual(["li.jpg", "li.jpg"]);
  });
});

describe("buildSceneCharacterContext — identityPrompt", () => {
  const map = makeMap([
    makeChar("c1", "阿离", { canonical: ["li.jpg"] }),
    makeChar("c2", "萧然", { canonical: ["xiao.jpg"] }),
  ]);

  it("无 bible 时不产出 identityPrompt", () => {
    const ctx = buildSceneCharacterContext(makeScene(["阿离"]), map, undefined);
    expect(ctx.identityPrompt).toBeUndefined();
  });

  it("取主角色（第一个）的 canonicalPrompt", () => {
    const bible = makeBible([
      { name: "阿离", canonicalPrompt: "银发少女，红瞳" },
      { name: "萧然", canonicalPrompt: "黑衣剑客" },
    ]);
    const ctx = buildSceneCharacterContext(
      makeScene(["萧然", "阿离"]),
      map,
      bible
    );
    expect(ctx.identityPrompt).toBe("黑衣剑客");
  });

  it("bible 中查不到主角色时不产出 identityPrompt", () => {
    const bible = makeBible([{ name: "别人", canonicalPrompt: "无关" }]);
    const ctx = buildSceneCharacterContext(makeScene(["阿离"]), map, bible);
    expect(ctx.identityPrompt).toBeUndefined();
  });

  it("canonicalPrompt 为空字符串时不产出（falsy 短路）", () => {
    const bible = makeBible([{ name: "阿离", canonicalPrompt: "" }]);
    const ctx = buildSceneCharacterContext(makeScene(["阿离"]), map, bible);
    expect(ctx.identityPrompt).toBeUndefined();
  });

  it("canonicalPrompt 超长时截断到 200 字符", () => {
    const long = "描".repeat(500);
    const bible = makeBible([{ name: "阿离", canonicalPrompt: long }]);
    const ctx = buildSceneCharacterContext(makeScene(["阿离"]), map, bible);
    expect(ctx.identityPrompt).toHaveLength(200);
    expect(ctx.identityPrompt).toBe(long.slice(0, 200));
  });

  it("恰好 200 字符时不被改动", () => {
    const exact = "字".repeat(200);
    const bible = makeBible([{ name: "阿离", canonicalPrompt: exact }]);
    const ctx = buildSceneCharacterContext(makeScene(["阿离"]), map, bible);
    expect(ctx.identityPrompt).toBe(exact);
  });
});
