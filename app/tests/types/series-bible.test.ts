import { describe, it, expect } from "vitest";
import {
  parseStoryBible,
  isBibleEmpty,
  emptyBible,
} from "@/types/series-bible";

describe("parseStoryBible — 容错解析", () => {
  it("null / undefined → 空圣经", () => {
    expect(isBibleEmpty(parseStoryBible(null))).toBe(true);
    expect(isBibleEmpty(parseStoryBible(undefined))).toBe(true);
  });

  it("空对象 {} → 空圣经", () => {
    expect(isBibleEmpty(parseStoryBible({}))).toBe(true);
  });

  it("垃圾输入（字符串/数字/数组）→ 空圣经", () => {
    expect(isBibleEmpty(parseStoryBible("garbage"))).toBe(true);
    expect(isBibleEmpty(parseStoryBible(42))).toBe(true);
    expect(isBibleEmpty(parseStoryBible([1, 2, 3]))).toBe(true);
  });

  it("合法圣经原样往返", () => {
    const input = {
      version: 1,
      theme: "复仇与救赎",
      worldSetting: { era: "近未来", lore: "AI 觉醒" },
      locations: [{ name: "废弃教堂", description: "布满尘埃" }],
      props: [{ name: "怀表", description: "父亲遗物", firstEpisode: 1 }],
      characters: [{ name: "阿林", state: "受伤，失去记忆" }],
      threads: [
        {
          id: "thread-1-1",
          title: "神秘信件",
          status: "open",
          plantedEpisode: 1,
        },
      ],
      episodes: [
        {
          episodeNumber: 1,
          title: "序章",
          logline: "阿林醒来",
          endingHook: "门外有脚步声",
          hookType: "悬念",
        },
      ],
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    const bible = parseStoryBible(input);
    expect(bible.theme).toBe("复仇与救赎");
    expect(bible.worldSetting?.era).toBe("近未来");
    expect(bible.locations).toHaveLength(1);
    expect(bible.characters[0].name).toBe("阿林");
    expect(bible.threads[0].status).toBe("open");
    expect(bible.episodes[0].hookType).toBe("悬念");
    expect(isBibleEmpty(bible)).toBe(false);
  });

  it("部分字段坏掉：坏条目被剔除，好条目保留", () => {
    const input = {
      characters: [
        { name: "阿林", state: "正常" },
        { state: "缺 name，应被丢弃" }, // 缺必填 name
        { name: "小雨", state: "紧张" },
      ],
      episodes: [
        { episodeNumber: 1, title: "第一集", logline: "x", endingHook: "y" },
        { title: "缺 episodeNumber，应被丢弃" },
      ],
    };
    const bible = parseStoryBible(input);
    expect(bible.characters.map((c) => c.name)).toEqual(["阿林", "小雨"]);
    expect(bible.episodes).toHaveLength(1);
  });

  it("非法 hookType / status → 降级（status 回 open，hookType 丢弃）", () => {
    const bible = parseStoryBible({
      threads: [{ id: "t1", title: "线", status: "不合法", plantedEpisode: 2 }],
      episodes: [
        {
          episodeNumber: 1,
          title: "a",
          logline: "b",
          endingHook: "c",
          hookType: "乱写",
        },
      ],
    });
    expect(bible.threads[0].status).toBe("open");
    expect(bible.episodes[0].hookType).toBeUndefined();
  });

  it("emptyBible 是全新引用（无共享可变状态）", () => {
    const a = emptyBible();
    const b = emptyBible();
    a.locations.push({ name: "x", description: "y" });
    expect(b.locations).toHaveLength(0);
  });
});

describe("parseStoryBible — colorScript 色彩指定（向后兼容）", () => {
  it("老圣经（无 colorScript 字段）正常解析，不报错，字段缺席", () => {
    const bible = parseStoryBible({
      version: 1,
      theme: "复仇",
      episodes: [
        { episodeNumber: 1, title: "序", logline: "x", endingHook: "y" },
      ],
    });
    expect(bible.colorScript).toBeUndefined();
    expect(isBibleEmpty(bible)).toBe(false); // theme 撑起内容
  });

  it("合法 colorScript 原样往返", () => {
    const bible = parseStoryBible({
      colorScript: {
        keyColors: ["warm amber", "deep teal shadow", "muted rose"],
        overallTone: "desaturated cinematic teal-and-orange",
        moodPalettes: [
          { mood: "tense", palette: "cold blue with harsh contrast" },
        ],
      },
    });
    expect(bible.colorScript?.keyColors).toEqual([
      "warm amber",
      "deep teal shadow",
      "muted rose",
    ]);
    expect(bible.colorScript?.overallTone).toBe(
      "desaturated cinematic teal-and-orange"
    );
    expect(bible.colorScript?.moodPalettes?.[0].mood).toBe("tense");
  });

  it("仅有 colorScript 时圣经非空（isBibleEmpty 计入色板）", () => {
    const bible = parseStoryBible({
      colorScript: { overallTone: "warm nostalgic sepia" },
    });
    expect(isBibleEmpty(bible)).toBe(false);
  });

  it("坏 colorScript（keyColors 混入空串/null，moodPalettes 缺 mood）→ 清洗", () => {
    const bible = parseStoryBible({
      colorScript: {
        keyColors: ["warm amber", "", null, "  "],
        moodPalettes: [
          { mood: "tense", palette: "cold blue" },
          { palette: "缺 mood，应被丢弃" }, // 缺必填 mood
        ],
      },
    });
    expect(bible.colorScript?.keyColors).toEqual(["warm amber"]);
    expect(bible.colorScript?.moodPalettes).toHaveLength(1);
    expect(bible.colorScript?.moodPalettes?.[0].mood).toBe("tense");
  });

  it("全空 colorScript → 字段缺席（等价无该字段）", () => {
    const bible = parseStoryBible({
      colorScript: { keyColors: [], moodPalettes: [], overallTone: "  " },
    });
    expect(bible.colorScript).toBeUndefined();
    expect(isBibleEmpty(bible)).toBe(true);
  });

  it("colorScript 是垃圾（字符串/数字）→ 降级缺席，不影响其它字段", () => {
    const bible = parseStoryBible({
      theme: "复仇",
      colorScript: "garbage",
    });
    expect(bible.colorScript).toBeUndefined();
    expect(bible.theme).toBe("复仇");
  });
});
