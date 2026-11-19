import { describe, expect, it } from "vitest";
import { ScriptZ } from "@/lib/short-video/contracts";
import { HotRequestZ } from "@/lib/short-video/hot-discovery";
import { buildHotBrief } from "@/services/short-video/hot-discovery/ideas";
import { parseDouyinBoard } from "@/services/short-video/hot-discovery/sources";
const now = new Date("2026-11-19T12:10:00Z");
const board = () =>
  parseDouyinBoard(
    {
      status_code: 0,
      data: {
        active_time: "2026-11-19 20:04:36",
        word_list: [
          { word: "慌啥子嘛要好好吃饭呀", position: 17 },
          { word: "谢谢小猫递来的红薯", position: 20 },
          { word: "某地发生严重地震多人死亡", position: 1 },
        ],
      },
    },
    now
  );
describe("grounded abstract-video brief", () => {
  it("recommends a grounded topic with an executable original script, no invented platform facts", () => {
    const report = buildHotBrief(
      {
        query: "搜索一下有啥最新的梗可以做成抽象视频吗",
        platforms: ["DOUYIN"],
        style: "XIANXIA",
        windowDays: 3,
      },
      [board()],
      now
    );
    expect(report.ideas).toHaveLength(2);
    expect(report.recommendation).toBeTruthy();
    expect(report.summary).not.toContain("今日官方热榜");
    for (const idea of report.ideas) {
      expect(ScriptZ.safeParse(idea.script).success).toBe(true);
      expect(report.topics.some((t) => t.id === idea.topicId)).toBe(true);
    }
    expect(report.ideas.some((i) => /地震|死亡/.test(i.title))).toBe(false);
    expect(report.ideas.find((i) => i.category === "RELAX")?.outline).toContain(
      "雷"
    );
  });
  it("never makes a recommendation from stale or undated evidence and reports missing platforms", () => {
    const b = board();
    b.items.forEach((t) => {
      t.snapshotAt = "2026-10-01T00:00:00Z";
    });
    const report = buildHotBrief(
      {
        query: "猫",
        platforms: ["DOUYIN", "XIAOHONGSHU"],
        style: "ANIMALS",
        windowDays: 1,
      },
      [
        b,
        {
          platform: "XIAOHONGSHU",
          status: "UNAVAILABLE",
          items: [],
          reason: "未取得可验证结果",
          fetchedAt: now.toISOString(),
          sourceUrl: null,
        },
      ],
      now
    );
    expect(report.ideas).toHaveLength(0);
    expect(report.recommendation).toBeNull();
    expect(report.summary).toContain("未取得");
  });
  it("validates bounded queries and de-duplicates platform choices", () => {
    expect(
      HotRequestZ.safeParse({
        requestId: crypto.randomUUID(),
        query: "x".repeat(501),
        platforms: ["DOUYIN"],
        style: "XIANXIA",
        windowDays: 3,
      }).success
    ).toBe(false);
    expect(
      HotRequestZ.parse({
        requestId: crypto.randomUUID(),
        query: "热点",
        platforms: ["DOUYIN", "DOUYIN"],
      }).platforms
    ).toEqual(["DOUYIN"]);
  });
});

describe("diverse original drafts and topical intent", () => {
  const topics = [
    "慌啥子嘛要好好吃饭呀",
    "慌啥子嘛弹唱版",
    "谢谢小猫递来的红薯",
    "火系长老坚持特辣",
    "打工人的下班仪式",
    "严苛的训练几乎要了我的命",
    "APEC会议围巾的中国式浪漫",
  ];
  it.each(["XIANXIA", "ANIMALS", "DAILY"] as const)(
    "produces distinct coherent drafts in %s while preserving evidence",
    (style) => {
      const source = parseDouyinBoard(
        {
          status_code: 0,
          data: {
            active_time: "2026-11-19 20:04:36",
            word_list: topics.map((word, i) => ({ word, position: i + 1 })),
          },
        },
        now
      );
      const r = buildHotBrief(
        { query: "最新梗", platforms: ["DOUYIN"], style, windowDays: 1 },
        [source],
        now
      );
      expect(r.ideas).toHaveLength(5);
      expect(new Set(r.ideas.map((i) => i.title)).size).toBe(5);
      for (const idea of r.ideas)
        expect(ScriptZ.safeParse(idea.script).success).toBe(true);
      expect(r.ideas.some((i) => i.outline.includes("APEC"))).toBe(false);
    }
  );
  it("supports explicit food intent and animal subject instead of repeating the same meme variants", () => {
    const source = parseDouyinBoard(
      {
        status_code: 0,
        data: {
          active_time: "2026-11-19 20:04:36",
          word_list: [
            { word: "麦穗与羊故事走红" },
            { word: "忘情牛肉面舞蹈大赛" },
          ],
        },
      },
      now
    );
    const a = buildHotBrief(
      {
        query: "找美食相关的梗",
        platforms: ["DOUYIN"],
        style: "XIANXIA",
        windowDays: 3,
      },
      [source],
      now
    );
    expect(a.ideas).toHaveLength(1);
    expect(a.ideas[0].category).toBe("FOOD");
    const b = buildHotBrief(
      {
        query: "最新梗",
        platforms: ["DOUYIN"],
        style: "ANIMALS",
        windowDays: 3,
      },
      [source],
      now
    );
    expect(
      b.ideas.find((i) => i.category === "ANIMAL")?.script.characters[0].name
    ).toContain("羊");
  });
});
