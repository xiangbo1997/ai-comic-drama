/**
 * 本集结尾钩子解析（resolveEpisodeEndingHook）单测。
 *
 * 背景缺陷：预览端片尾钩子卡的 hookText 曾硬编码 null，永远显示兜底通用文案，
 * 而导出端从故事圣经按本集匹配真钩子——违反「预览必须反映导出效果」。
 * 现在两端共用本函数，本测试锁定它的匹配语义。
 */

import { describe, it, expect } from "vitest";
import { resolveEpisodeEndingHook } from "@/lib/series";
import { parseStoryBible } from "@/types/series-bible";

/** 构造含分集表的圣经（过 parseStoryBible 以贴合真实调用路径） */
function bibleWithEpisodes(
  episodes: Array<{ episodeNumber: number; endingHook: string }>
) {
  return parseStoryBible({
    version: 1,
    episodes: episodes.map((e) => ({
      episodeNumber: e.episodeNumber,
      title: `第${e.episodeNumber}集`,
      logline: "梗概",
      endingHook: e.endingHook,
    })),
  });
}

describe("resolveEpisodeEndingHook · 按本集匹配", () => {
  it("命中本集 → 返回该集钩子（不是最后一集的）", () => {
    const bible = bibleWithEpisodes([
      { episodeNumber: 1, endingHook: "第一集的钩子" },
      { episodeNumber: 2, endingHook: "第二集的钩子" },
      { episodeNumber: 3, endingHook: "第三集的钩子" },
    ]);
    expect(resolveEpisodeEndingHook(bible, 2)).toBe("第二集的钩子");
  });

  it("集数在圣经里没有条目 → null（由 buildTitleCards 兜底通用文案）", () => {
    const bible = bibleWithEpisodes([
      { episodeNumber: 1, endingHook: "第一集的钩子" },
    ]);
    expect(resolveEpisodeEndingHook(bible, 7)).toBeNull();
  });

  it("钩子为空串/纯空白 → null", () => {
    const bible = bibleWithEpisodes([
      { episodeNumber: 1, endingHook: "" },
      { episodeNumber: 2, endingHook: "   " },
    ]);
    expect(resolveEpisodeEndingHook(bible, 1)).toBeNull();
    expect(resolveEpisodeEndingHook(bible, 2)).toBeNull();
  });

  it("钩子两端空白被裁剪", () => {
    const bible = bibleWithEpisodes([
      { episodeNumber: 1, endingHook: "  她的秘密即将被揭穿  " },
    ]);
    expect(resolveEpisodeEndingHook(bible, 1)).toBe("她的秘密即将被揭穿");
  });
});

describe("resolveEpisodeEndingHook · 集数缺省", () => {
  it("episodeNumber 为 null / undefined → null（非系列项目无本集概念）", () => {
    const bible = bibleWithEpisodes([{ episodeNumber: 1, endingHook: "钩子" }]);
    expect(resolveEpisodeEndingHook(bible, null)).toBeNull();
    expect(resolveEpisodeEndingHook(bible, undefined)).toBeNull();
  });

  it("空圣经 → null（永不抛错）", () => {
    const empty = parseStoryBible(null);
    expect(resolveEpisodeEndingHook(empty, 1)).toBeNull();
  });

  it("脏 JSON 圣经 → parseStoryBible 容错为空，仍返回 null", () => {
    const garbage = parseStoryBible({ episodes: "not-an-array" });
    expect(resolveEpisodeEndingHook(garbage, 1)).toBeNull();
  });
});
