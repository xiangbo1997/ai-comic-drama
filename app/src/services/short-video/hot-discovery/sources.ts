import { z } from "zod";
import { safeFetch } from "@/lib/url-guard";
import { searchAssistantWeb } from "@/services/assistant-web-search";
import { platformPostUrl } from "@/lib/short-video/source";
import { stableHash } from "@/lib/short-video/hash";
import type {
  HotBoard,
  HotPlatform,
  HotTopic,
} from "@/lib/short-video/hot-discovery";
const DOUYIN =
  "https://aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880";
const KUAISHOU = "https://tophub.today/n/MZd7PrPerO";
const names = {
  DOUYIN: "抖音公开热搜",
  KUAISHOU: "今日热榜·快手",
  XIAOHONGSHU: "小红书公开网页检索",
};
function topic(
  platform: HotPlatform,
  title: string,
  url: string,
  now: Date,
  rest: Partial<HotTopic>
): HotTopic {
  return {
    id: stableHash({ platform, title }).slice(0, 32),
    platform,
    title,
    url,
    sourceName: names[platform],
    sourceUrl: url,
    evidenceKind: "WEB_SEARCH",
    rank: null,
    heat: null,
    heatLabel: null,
    fetchedAt: now.toISOString(),
    snapshotAt: null,
    publishedAt: null,
    timeBasis: "UNKNOWN",
    snippet: "",
    ...rest,
  };
}
function beijingTime(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw))
    throw Error("来源更新时间缺失");
  const value = new Date(raw.replace(" ", "T") + "+08:00");
  if (!Number.isFinite(value.getTime())) throw Error("来源时间无效");
  return value.toISOString();
}
export function parseDouyinBoard(raw: unknown, now: Date): HotBoard {
  const data = z
    .object({
      status_code: z.literal(0),
      data: z.object({
        active_time: z.string().min(1),
        word_list: z
          .array(
            z.object({
              word: z.string().trim().min(1).max(200),
              position: z.number().int().positive().optional(),
              hot_value: z.number().nonnegative().optional(),
            })
          )
          .max(100),
      }),
    })
    .parse(raw).data;
  const snapshotAt = beijingTime(data.active_time);
  const seen = new Set<string>();
  const items = data.word_list.flatMap((item, i) => {
    if (seen.has(item.word)) return [];
    seen.add(item.word);
    return [
      topic(
        "DOUYIN",
        item.word,
        `https://www.douyin.com/search/${encodeURIComponent(item.word)}`,
        now,
        {
          sourceUrl: DOUYIN,
          evidenceKind: "PUBLIC_BOARD",
          snapshotAt,
          timeBasis: "SOURCE_TEXT",
          rank: item.position ?? i + 1,
          heat: item.hot_value ?? null,
          heatLabel:
            item.hot_value !== undefined ? String(item.hot_value) : null,
        }
      ),
    ];
  });
  if (!items.length) throw Error("来源未返回榜单");
  return {
    platform: "DOUYIN",
    status: "AVAILABLE",
    items,
    fetchedAt: now.toISOString(),
    sourceUrl: DOUYIN,
    reason:
      "公开榜单读取，非开发者授权搜索API；只证明该快照中出现的话题，不证明相关视频数量。",
  };
}
function plain(raw: string) {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Math.min(Number(n), 0x10ffff))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff))
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}
export function parseKuaishouBoard(html: string, now: Date): HotBoard {
  if (!/<title>快手实时热榜/.test(html)) throw Error("不是快手榜单页");
  const table = /<table\b[^>]*class="table"[^>]*>([\s\S]*?)<\/table>/.exec(
    html
  )?.[1];
  if (!table) throw Error("来源没有公开榜单");
  const relative = /(\d{1,4})\s*分钟前更新/.exec(html);
  const snapshotAt = relative
    ? new Date(now.getTime() - Number(relative[1]) * 60000).toISOString()
    : null;
  const items: HotTopic[] = [];
  const seen = new Set<string>();
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(
      (m) => m[1]
    );
    const link = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(
      cells[1] || ""
    );
    if (!link) continue;
    const title = plain(link[2]).slice(0, 200);
    const url = plain(link[1]);
    try {
      platformPostUrl("KUAISHOU", url);
    } catch {
      continue;
    }
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const rank = Number.parseInt(plain(cells[0] || ""));
    items.push(
      topic("KUAISHOU", title, url, now, {
        sourceUrl: KUAISHOU,
        evidenceKind: "AGGREGATE_BOARD",
        snapshotAt,
        timeBasis: snapshotAt ? "RELATIVE" : "UNKNOWN",
        rank: rank > 0 ? rank : null,
        heatLabel: plain(cells[2] || "").slice(0, 40) || null,
      })
    );
    if (items.length === 100) break;
  }
  if (!items.length) throw Error("来源未返回有效话题");
  return {
    platform: "KUAISHOU",
    status: snapshotAt ? "AVAILABLE" : "PARTIAL",
    items,
    fetchedAt: now.toISOString(),
    sourceUrl: KUAISHOU,
    reason: snapshotAt
      ? "第三方榜单快照；更新时间依据页面相对时间估算，热度按原文展示，不等于播放量。"
      : "来源未给出可验证更新时间，不能标为近期热点。",
  };
}
export function freshTopic(item: HotTopic, now: Date, days: number) {
  if (!item.snapshotAt || item.evidenceKind === "WEB_SEARCH") return false;
  const age = now.getTime() - Date.parse(item.snapshotAt);
  return Number.isFinite(age) && age >= -300000 && age <= days * 86400000;
}
export function filterWebCandidates(
  platform: HotPlatform,
  entries: Array<{ title: string; url: string; snippet: string }>,
  now: Date
): HotTopic[] {
  const seen = new Set<string>();
  return entries
    .flatMap((item) => {
      try {
        const url = platformPostUrl(platform, item.url);
        if (
          !/^\/(explore\/[^/]+|discovery\/item\/[^/]+|short-video\/[^/]+|video\/[^/]+)/.test(
            url.pathname
          ) ||
          seen.has(item.url)
        )
          return [];
        seen.add(item.url);
        return [
          topic(platform, item.title.slice(0, 200), url.toString(), now, {
            sourceName: "Bing公开网页检索",
            sourceUrl: "https://www.bing.com/search",
            snippet: item.snippet.slice(0, 1000),
          }),
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 5);
}
async function readPublic(url: string) {
  const response = await safeFetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json,text/html;q=0.9",
    },
  });
  if (!response.ok || !response.body) throw Error("来源不可用");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw Error("来源响应过大");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
// 固定公开来源，不接收任意出站URL，不保存网页/cookies/签名图；最多读取每平台一份快照。
export async function fetchHotBoard(
  platform: HotPlatform,
  query: string,
  now = new Date()
): Promise<HotBoard> {
  const sourceUrl =
    platform === "DOUYIN" ? DOUYIN : platform === "KUAISHOU" ? KUAISHOU : null;
  try {
    if (platform === "DOUYIN")
      return parseDouyinBoard(JSON.parse(await readPublic(DOUYIN)), now);
    if (platform === "KUAISHOU")
      return parseKuaishouBoard(await readPublic(KUAISHOU), now);
    const search = await searchAssistantWeb(
      `site:xiaohongshu.com ${query.slice(0, 200)} 热梗`
    );
    const items = filterWebCandidates(platform, search.results, now);
    return {
      platform,
      status: items.length ? "PARTIAL" : "UNAVAILABLE",
      items,
      sourceUrl: "https://www.bing.com/search",
      fetchedAt: now.toISOString(),
      reason: items.length
        ? "仅公开网页候选，未核验发布时间或是否在榜；不作为最新梗推荐依据。"
        : "未取得可验证的小红书热点；公开检索没有有效内容链接，平台热榜尚不可用。可手动导入来源。",
    };
  } catch {
    return {
      platform,
      status: "UNAVAILABLE",
      items: [],
      sourceUrl,
      fetchedAt: now.toISOString(),
      reason:
        "未取得有效公开榜单：来源超时、限流或结构变化。没有用历史缓存或示例替代实时结果。",
    };
  }
}
