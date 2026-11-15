import { XMLParser } from "fast-xml-parser";
import { safeFetch } from "@/lib/url-guard";

export async function searchAssistantWeb(query: string, signal?: AbortSignal) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("format", "rss");
  url.searchParams.set("q", query);
  const timeout = AbortSignal.timeout(12_000);
  const response = await safeFetch(url.toString(), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!response.ok || !response.body) throw new Error("联网搜索暂时不可用");
  // 对外部响应流限额，不能先完整读取再检查大小。
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256_000) {
        await reader.cancel();
        throw new Error("搜索响应过大，请缩小查询范围");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const xml = Buffer.concat(chunks).toString("utf8");
  const data = new XMLParser({
    processEntities: false,
    ignoreAttributes: true,
  }).parse(xml);
  if (!data?.rss?.channel) throw new Error("搜索服务未返回有效结果");
  const items = data.rss.channel.item ?? [];
  const results = (Array.isArray(items) ? items : [items])
    .flatMap((item: Record<string, unknown>) => {
      if (typeof item.link !== "string" || !/^https?:\/\//i.test(item.link))
        return [];
      return [
        {
          title: String(item.title ?? "").slice(0, 200),
          url: item.link.slice(0, 2000),
          snippet: String(item.description ?? "")
            .replace(/<[^>]*>/g, "")
            .slice(0, 1000),
        },
      ];
    })
    .slice(0, 5);
  return { query, retrievedAt: new Date().toISOString(), results };
}
