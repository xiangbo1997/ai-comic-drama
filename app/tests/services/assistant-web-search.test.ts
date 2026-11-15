import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: mocks.fetch }));
import { searchAssistantWeb } from "@/services/assistant-web-search";
beforeEach(() => vi.clearAllMocks());
describe("助手联网搜索", () => {
  it("实际请求搜索服务并输出来源，过滤危险协议", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        "<rss><channel><item><title>镜头语言</title><link>https://example.com/film</link><description>实践资料</description></item><item><title>bad</title><link>javascript:alert(1)</link></item></channel></rss>"
      )
    );
    const result = await searchAssistantWeb("镜头语言 & 构图");
    const url = new URL(mocks.fetch.mock.calls[0][0]);
    expect(url.hostname).toBe("www.bing.com");
    expect(url.searchParams.get("q")).toBe("镜头语言 & 构图");
    expect(result.results).toEqual([
      {
        title: "镜头语言",
        url: "https://example.com/film",
        snippet: "实践资料",
      },
    ]);
  });
  it("错误、验证码与过大响应明确失败", async () => {
    for (const response of [
      new Response("failed", { status: 503 }),
      new Response("<html>captcha</html>"),
      new Response("x".repeat(256001)),
    ]) {
      mocks.fetch.mockResolvedValueOnce(response);
      await expect(searchAssistantWeb("test")).rejects.toThrow();
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it("空结果不伪造来源", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("<rss><channel><title>Search</title></channel></rss>")
    );
    expect((await searchAssistantWeb("无结果")).results).toEqual([]);
  });
});
