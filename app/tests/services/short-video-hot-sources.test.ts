import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({
  safeFetch: m.fetch,
  assertSafeUrlLiteral: (url: string) => {
    if (/127\.0\.0\.1|file:/.test(url)) throw Error("unsafe");
  },
}));
vi.mock("@/services/assistant-web-search", () => ({
  searchAssistantWeb: m.search,
}));
import {
  parseDouyinBoard,
  parseKuaishouBoard,
  fetchHotBoard,
  freshTopic,
  filterWebCandidates,
} from "@/services/short-video/hot-discovery/sources";
const now = new Date("2026-11-19T12:10:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  m.search.mockResolvedValue({ retrievedAt: now.toISOString(), results: [] });
});
describe("hot topic source facts", () => {
  it("parses original source timestamps in Beijing instead of trusting broken aggregate milliseconds", () => {
    const board = parseDouyinBoard(
      {
        status_code: 0,
        data: {
          active_time: "2026-11-19 20:04:36",
          word_list: [
            {
              word: "慌啥子嘛要好好吃饭呀",
              position: 17,
              hot_value: 12345,
              event_time: 1795000000,
            },
          ],
        },
      },
      now
    );
    expect(board.items[0].title).toBe("慌啥子嘛要好好吃饭呀");
    expect(board.items[0].snapshotAt).toBe("2026-11-19T12:04:36.000Z");
    expect(board.items[0].publishedAt).toBeNull();
    expect(board.items[0].evidenceKind).toBe("PUBLIC_BOARD");
    expect(board.items[0].url).toContain("www.douyin.com/search/");
  });
  it("rejects invalid schema, missing timestamps, duplicate entries and stale boards", () => {
    expect(() => parseDouyinBoard({}, now)).toThrow();
    expect(() =>
      parseDouyinBoard({ status_code: 0, data: { word_list: [] } }, now)
    ).toThrow();
    const board = parseDouyinBoard(
      {
        status_code: 0,
        data: {
          active_time: "2026-11-01 00:00:00",
          word_list: [
            { word: "旧梗", position: 1 },
            { word: "旧梗", position: 2 },
          ],
        },
      },
      now
    );
    expect(board.items).toHaveLength(1);
    expect(freshTopic(board.items[0], now, 3)).toBe(false);
  });
  it("parses only real platform links from public aggregate rows and labels approximate source time", () => {
    const html =
      '<title>快手实时热榜 - 今日热榜</title><span>19分钟前更新</span><table class="table"><tbody><tr><td>8.</td><td><a href="https://index.e.kuaishou.com/rank/hotDetail?keyword=小猫">小猫催我下班</a></td><td class="ws">13.2万</td></tr><tr><td>9.</td><td><a href="https://evil.test/fake">伪链接</a></td><td>99万</td></tr></tbody></table>';
    const result = parseKuaishouBoard(html, now);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: "小猫催我下班",
      sourceName: "今日热榜·快手",
      heat: null,
      heatLabel: "13.2万",
      timeBasis: "RELATIVE",
      evidenceKind: "AGGREGATE_BOARD",
    });
    expect(result.items[0].snapshotAt).toBe("2026-11-19T11:51:00.000Z");
    expect(() => parseKuaishouBoard("<html>请登录</html>", now)).toThrow();
  });
  it("does not interpret search crawl date or a homepage as fresh trending evidence", () => {
    const result = filterWebCandidates(
      "XIAOHONGSHU",
      [
        {
          title: "小红书",
          url: "https://www.xiaohongshu.com/",
          snippet: "首页",
        },
        {
          title: "微软新闻",
          url: "https://www.microsoft.com/",
          snippet: "今天",
        },
        {
          title: "猫咪反向训人",
          url: "https://www.xiaohongshu.com/explore/12345",
          snippet: "日常灵感",
        },
      ],
      now
    );
    expect(result).toHaveLength(1);
    expect(result[0].publishedAt).toBeNull();
    expect(result[0].snapshotAt).toBeNull();
    expect(freshTopic(result[0], now, 3)).toBe(false);
  });
  it("bounds response size, respects unavailable sources and never returns made-up fallback items", async () => {
    m.fetch.mockResolvedValue(new Response("x".repeat(1100000)));
    const result = await fetchHotBoard("DOUYIN", "热梗", now);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.items).toEqual([]);
    expect(m.fetch).toHaveBeenCalledOnce();
  });
  it("reports actual XHS search limitations instead of manufacturing a third platform board", async () => {
    const result = await fetchHotBoard("XIAOHONGSHU", "最新的梗", now);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.items).toHaveLength(0);
    expect(m.search).toHaveBeenCalledOnce();
    expect(result.reason).toContain("未取得");
  });
});

it("reads actual bounded board contracts and marks undated content links as partial", async () => {
  m.fetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        status_code: 0,
        data: {
          active_time: "2026-11-19 20:04:36",
          word_list: [{ word: "慢慢来" }],
        },
      })
    )
  );
  expect((await fetchHotBoard("DOUYIN", "梗", now)).status).toBe("AVAILABLE");
  m.fetch.mockResolvedValueOnce(
    new Response(
      '<title>快手实时热榜</title><table class="table"><tr><td>1.</td><td><a href="https://www.kuaishou.com/short-video/123">吃饭打卡</a></td><td>1万</td></tr></table>'
    )
  );
  expect((await fetchHotBoard("KUAISHOU", "梗", now)).status).toBe("PARTIAL");
  m.search.mockResolvedValueOnce({
    results: [
      {
        title: "猫咪反向训人",
        url: "https://www.xiaohongshu.com/explore/123",
        snippet: "灵感",
      },
    ],
  });
  const result = await fetchHotBoard("XIAOHONGSHU", "猫", now);
  expect(result.status).toBe("PARTIAL");
  expect(result.items[0].snapshotAt).toBeNull();
  m.fetch.mockResolvedValueOnce(new Response("busy", { status: 429 }));
  expect((await fetchHotBoard("DOUYIN", "梗", now)).status).toBe("UNAVAILABLE");
  expect(m.fetch).toHaveBeenCalledTimes(3);
});
