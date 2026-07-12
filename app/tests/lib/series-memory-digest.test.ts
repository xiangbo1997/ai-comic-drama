import { describe, it, expect } from "vitest";
import { buildSeriesMemoryDigest } from "@/lib/series";
import { emptyBible, type SeriesStoryBible } from "@/types/series-bible";

/** 造一份「有内容」的圣经，用于预算/字段测试 */
function richBible(over: Partial<SeriesStoryBible> = {}): SeriesStoryBible {
  return {
    ...emptyBible(),
    theme: "复仇与救赎",
    worldSetting: { era: "近未来", lore: "AI 觉醒的都市" },
    locations: [
      { name: "废弃教堂", description: "布满尘埃" },
      { name: "地下市场", description: "霓虹闪烁" },
    ],
    props: [{ name: "怀表", description: "父亲遗物" }],
    characters: [
      { name: "阿林", state: "失去左臂", forbiddenChanges: "左臂不可复原" },
      { name: "小雨", state: "隐藏身份" },
    ],
    threads: [
      {
        id: "t1",
        title: "神秘信件",
        status: "open",
        plantedEpisode: 1,
      },
      {
        id: "t2",
        title: "已了结的债",
        status: "resolved",
        plantedEpisode: 1,
        resolvedEpisode: 2,
      },
    ],
    episodes: [
      {
        episodeNumber: 1,
        title: "序章",
        logline: "阿林醒来",
        endingHook: "门外脚步声",
        hookType: "悬念",
      },
      {
        episodeNumber: 2,
        title: "追击",
        logline: "逃亡",
        endingHook: "被包围",
        hookType: "危机",
      },
      {
        episodeNumber: 3,
        title: "真相",
        logline: "揭露",
        endingHook: "反转身份",
        hookType: "反转",
      },
    ],
    updatedAt: "2026-07-12T00:00:00.000Z",
    ...over,
  };
}

describe("buildSeriesMemoryDigest — 空圣经", () => {
  it("空圣经 → null（两个 stage 都是）", () => {
    expect(
      buildSeriesMemoryDigest(emptyBible(), { stage: "script" })
    ).toBeNull();
    expect(
      buildSeriesMemoryDigest(emptyBible(), { stage: "scene" })
    ).toBeNull();
  });
});

describe("buildSeriesMemoryDigest — script stage", () => {
  it("包含主题锁 / 未解决伏笔 / 角色状态 / 既定设定", () => {
    const d = buildSeriesMemoryDigest(richBible(), { stage: "script" });
    expect(d).not.toBeNull();
    expect(d).toContain("复仇与救赎");
    expect(d).toContain("神秘信件"); // open 伏笔
    expect(d).not.toContain("已了结的债"); // resolved 不列
    expect(d).toContain("阿林");
    expect(d).toContain("左臂不可复原"); // forbiddenChanges 出现
    expect(d).toContain("废弃教堂");
  });

  it("含「近 N 集钩子类型」行", () => {
    const d = buildSeriesMemoryDigest(richBible(), { stage: "script" })!;
    expect(d).toContain("钩子类型");
    // 近 3 集钩子类型：悬念/危机/反转
    expect(d).toContain("反转");
  });

  it("预算 ≤ 2000 字", () => {
    const long = "设".repeat(5000);
    const big = richBible({
      worldSetting: { lore: long },
      characters: Array.from({ length: 50 }, (_, i) => ({
        name: `角色${i}`,
        state: "状".repeat(100),
      })),
    });
    const d = buildSeriesMemoryDigest(big, { stage: "script" })!;
    expect(d.length).toBeLessThanOrEqual(2000);
  });

  it("currentEpisode=3 时上一集结尾钩来自第 2 集", () => {
    const d = buildSeriesMemoryDigest(richBible(), {
      stage: "script",
      currentEpisode: 3,
    })!;
    expect(d).toContain("上一集结尾钩（本集开场承接）：被包围");
  });
});

describe("buildSeriesMemoryDigest — scene stage", () => {
  it("含角色状态 + 上一集钩子 + 既定场景/道具，但不含主题/伏笔全局叙事", () => {
    const d = buildSeriesMemoryDigest(richBible(), {
      stage: "scene",
      currentEpisode: 3,
    })!;
    expect(d).toContain("阿林");
    expect(d).toContain("被包围"); // 上一集(第2集)结尾钩
    expect(d).toContain("废弃教堂");
    // scene 段不铺全局主题锁那一段
    expect(d).not.toContain("主题锁");
  });

  it("预算 ≤ 600 字", () => {
    const big = richBible({
      characters: Array.from({ length: 30 }, (_, i) => ({
        name: `角色${i}`,
        state: "状".repeat(60),
      })),
    });
    const d = buildSeriesMemoryDigest(big, { stage: "scene" })!;
    expect(d.length).toBeLessThanOrEqual(600);
  });

  it("scene 比 script 短（同一份圣经）", () => {
    const b = richBible();
    const script = buildSeriesMemoryDigest(b, { stage: "script" })!;
    const scene = buildSeriesMemoryDigest(b, { stage: "scene" })!;
    expect(scene.length).toBeLessThan(script.length);
  });
});

describe("buildSeriesMemoryDigest — colorScript 色彩指定注入", () => {
  const paletteBible = richBible({
    colorScript: {
      keyColors: ["warm amber", "deep teal shadow"],
      overallTone: "desaturated teal-and-orange",
      moodPalettes: [{ mood: "紧张", palette: "cold blue harsh contrast" }],
    },
  });

  it("scene 阶段：注入主色板 + 整体色调 + 情绪色调，带出图必须遵守前缀", () => {
    const d = buildSeriesMemoryDigest(paletteBible, { stage: "scene" })!;
    expect(d).toContain("色彩指定");
    expect(d).toContain("出图必须遵守");
    expect(d).toContain("warm amber");
    expect(d).toContain("desaturated teal-and-orange");
    expect(d).toContain("紧张→cold blue harsh contrast");
  });

  it("script 阶段：极简注入色彩基调（主色板+整体色调，不带情绪色调）", () => {
    const d = buildSeriesMemoryDigest(paletteBible, { stage: "script" })!;
    expect(d).toContain("色彩基调");
    expect(d).toContain("warm amber");
    expect(d).toContain("desaturated teal-and-orange");
    // script 阶段不铺情绪色调明细
    expect(d).not.toContain("cold blue harsh contrast");
  });

  it("仅 colorScript 的圣经（无角色/场景）scene 阶段也能出色板", () => {
    const onlyColor: SeriesStoryBible = {
      ...emptyBible(),
      colorScript: { overallTone: "warm nostalgic sepia" },
    };
    const d = buildSeriesMemoryDigest(onlyColor, { stage: "scene" });
    expect(d).not.toBeNull();
    expect(d).toContain("warm nostalgic sepia");
  });

  it("无 colorScript 的圣经：digest 不含色彩段（向后兼容）", () => {
    const d = buildSeriesMemoryDigest(richBible(), { stage: "scene" })!;
    expect(d).not.toContain("色彩指定");
  });
});
