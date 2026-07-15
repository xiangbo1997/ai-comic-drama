import { describe, it, expect } from "vitest";
import {
  mergeBible,
  type ChronicleExtraction,
} from "@/services/series/bible-merge";
import {
  emptyBible,
  type SeriesStoryBible,
  type ColorScript,
} from "@/types/series-bible";

/** 构造最小抽取（只填需要的字段，其余给空） */
function extraction(
  over: Partial<ChronicleExtraction> = {}
): ChronicleExtraction {
  return {
    episodeEntry: {
      title: "标题",
      logline: "梗概",
      endingHook: "钩子",
      ...over.episodeEntry,
    },
    characterUpdates: over.characterUpdates ?? [],
    newThreads: over.newThreads ?? [],
    resolvedThreadTitles: over.resolvedThreadTitles ?? [],
    newLocations: over.newLocations ?? [],
    newProps: over.newProps ?? [],
    loreAdditions: over.loreAdditions ?? [],
    themeProposal: over.themeProposal,
  };
}

describe("mergeBible — 分集功能表", () => {
  it("首次合并写入本集条目", () => {
    const b = mergeBible(emptyBible(), extraction(), 1);
    expect(b.episodes).toHaveLength(1);
    expect(b.episodes[0].episodeNumber).toBe(1);
    expect(b.episodes[0].endingHook).toBe("钩子");
  });

  it("同集重跑 = 幂等替换（不重复追加）", () => {
    let b = mergeBible(
      emptyBible(),
      extraction({
        episodeEntry: { title: "旧", logline: "l", endingHook: "h" },
      }),
      2
    );
    b = mergeBible(
      b,
      extraction({
        episodeEntry: { title: "新", logline: "l2", endingHook: "h2" },
      }),
      2
    );
    expect(b.episodes.filter((e) => e.episodeNumber === 2)).toHaveLength(1);
    expect(b.episodes[0].title).toBe("新");
  });

  it("多集按 episodeNumber 升序", () => {
    let b = mergeBible(emptyBible(), extraction(), 3);
    b = mergeBible(b, extraction(), 1);
    b = mergeBible(b, extraction(), 2);
    expect(b.episodes.map((e) => e.episodeNumber)).toEqual([1, 2, 3]);
  });

  it("不修改传入的原圣经（不可变）", () => {
    const before = emptyBible();
    mergeBible(before, extraction(), 1);
    expect(before.episodes).toHaveLength(0);
  });
});

describe("mergeBible — colorScript 保留（C2）", () => {
  const colorScript: ColorScript = {
    keyColors: ["warm amber", "deep teal shadow"],
    overallTone: "desaturated cinematic teal-and-orange",
  };

  it("用户锁定的 colorScript 归档后原样保留（史官不产出该字段，不得抹掉）", () => {
    const current: SeriesStoryBible = { ...emptyBible(), colorScript };
    const next = mergeBible(current, extraction(), 1);
    expect(next.colorScript).toEqual(colorScript);
  });

  it("多集连续归档不丢失 colorScript", () => {
    let b: SeriesStoryBible = { ...emptyBible(), colorScript };
    b = mergeBible(b, extraction(), 1);
    b = mergeBible(b, extraction(), 2);
    b = mergeBible(b, extraction(), 3);
    expect(b.colorScript).toEqual(colorScript);
  });

  it("无 colorScript 时归档后仍为 undefined（不凭空造）", () => {
    const next = mergeBible(emptyBible(), extraction(), 1);
    expect(next.colorScript).toBeUndefined();
  });
});

describe("mergeBible — 角色 upsert", () => {
  it("新角色新增；已有角色更新状态", () => {
    let b = mergeBible(
      emptyBible(),
      extraction({ characterUpdates: [{ name: "阿林", state: "健康" }] }),
      1
    );
    b = mergeBible(
      b,
      extraction({ characterUpdates: [{ name: "阿林", state: "受伤" }] }),
      2
    );
    expect(b.characters).toHaveLength(1);
    expect(b.characters[0].state).toBe("受伤");
    expect(b.characters[0].lastSeenEpisode).toBe(2);
  });

  it("角色名大小写不敏感匹配", () => {
    let b = mergeBible(
      emptyBible(),
      extraction({ characterUpdates: [{ name: "Lin", state: "a" }] }),
      1
    );
    b = mergeBible(
      b,
      extraction({ characterUpdates: [{ name: "lin", state: "b" }] }),
      2
    );
    expect(b.characters).toHaveLength(1);
    expect(b.characters[0].state).toBe("b");
  });

  it("角色状态超 120 字被截断", () => {
    const long = "状".repeat(200);
    const b = mergeBible(
      emptyBible(),
      extraction({ characterUpdates: [{ name: "x", state: long }] }),
      1
    );
    expect(b.characters[0].state.length).toBe(120);
  });
});

describe("mergeBible — 伏笔线生命周期", () => {
  it("新线分配 id 并置 open", () => {
    const b = mergeBible(
      emptyBible(),
      extraction({ newThreads: [{ title: "神秘信件" }] }),
      3
    );
    expect(b.threads).toHaveLength(1);
    expect(b.threads[0].status).toBe("open");
    expect(b.threads[0].plantedEpisode).toBe(3);
    expect(b.threads[0].id).toBe("thread-3-1");
  });

  it("resolvedThreadTitles 按标题解决对应 open 线", () => {
    let b = mergeBible(
      emptyBible(),
      extraction({ newThreads: [{ title: "神秘信件" }] }),
      1
    );
    b = mergeBible(b, extraction({ resolvedThreadTitles: ["神秘信件"] }), 2);
    expect(b.threads[0].status).toBe("resolved");
    expect(b.threads[0].resolvedEpisode).toBe(2);
  });

  it("同标题伏笔不重复埋", () => {
    let b = mergeBible(
      emptyBible(),
      extraction({ newThreads: [{ title: "同一条线" }] }),
      1
    );
    b = mergeBible(b, extraction({ newThreads: [{ title: "同一条线" }] }), 2);
    expect(b.threads).toHaveLength(1);
  });

  it("超过 30 条上限时优先丢最老的已解决线", () => {
    let b: SeriesStoryBible = emptyBible();
    // 埋 30 条并全部解决（都是已解决线）
    for (let i = 1; i <= 30; i++) {
      b = mergeBible(
        b,
        extraction({
          newThreads: [{ title: `线${i}` }],
          resolvedThreadTitles: [`线${i}`],
        }),
        i
      );
    }
    expect(b.threads).toHaveLength(30);
    // 第 31 集再埋一条新 open 线 → 触发上限，丢最老已解决线（线1）
    b = mergeBible(b, extraction({ newThreads: [{ title: "线31" }] }), 31);
    expect(b.threads).toHaveLength(30);
    expect(b.threads.some((t) => t.title === "线1")).toBe(false);
    expect(b.threads.some((t) => t.title === "线31")).toBe(true);
  });
});

describe("mergeBible — 场景/道具去重 + theme 锁定", () => {
  it("场景按名字去重", () => {
    let b = mergeBible(
      emptyBible(),
      extraction({ newLocations: [{ name: "教堂", description: "旧" }] }),
      1
    );
    b = mergeBible(
      b,
      extraction({ newLocations: [{ name: "教堂", description: "新" }] }),
      2
    );
    expect(b.locations).toHaveLength(1);
    expect(b.locations[0].description).toBe("旧"); // 已存在不覆盖
  });

  it("道具带首次出现集数", () => {
    const b = mergeBible(
      emptyBible(),
      extraction({ newProps: [{ name: "怀表", description: "遗物" }] }),
      4
    );
    expect(b.props[0].firstEpisode).toBe(4);
  });

  it("theme 只在缺失时锁定，之后不变", () => {
    let b = mergeBible(emptyBible(), extraction({ themeProposal: "主题A" }), 1);
    expect(b.theme).toBe("主题A");
    b = mergeBible(b, extraction({ themeProposal: "主题B" }), 2);
    expect(b.theme).toBe("主题A");
  });

  it("updatedAt 每次合并刷新", () => {
    const b = mergeBible(emptyBible(), extraction(), 1);
    expect(b.updatedAt).not.toBe("");
    expect(() => new Date(b.updatedAt).toISOString()).not.toThrow();
  });
});
