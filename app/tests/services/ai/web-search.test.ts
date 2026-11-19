import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: mocks.fetch }));
import { searchWebWithModel } from "@/services/ai/web-search";
import {
  validWebSearchSetting,
  webSearchTransport,
  searchConfigurationVerified,
} from "@/lib/ai-web-search";
const config = {
  apiKey: "test-only-key",
  baseUrl: "https://provider.example/v1/",
  model: "configured-model",
  protocol: "openai" as const,
  extraConfig: { webSearchTransport: "responses" },
};
const result = () => ({
  status: "completed",
  id: "resp-test",
  model: "resolved-model",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "正在搜索" }],
    },
    {
      type: "web_search_call",
      status: "completed",
      action: { type: "search" },
    },
    {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "真实来源上的原创改编",
          annotations: [
            {
              type: "url_citation",
              url: "https://source.example/topic",
              title: "真实资料",
            },
          ],
        },
      ],
    },
  ],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
});
beforeEach(() => {
  vi.clearAllMocks();
});
describe("shared model web search", () => {
  it("uses the configured model and credential, returns final answer, real tool evidence and usage", async () => {
    mocks.fetch.mockResolvedValue(Response.json(result()));
    const report = await searchWebWithModel(config, "找近期梗");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://provider.example/v1/responses");
    expect(JSON.parse(init.body)).toMatchObject({
      model: config.model,
      tools: [{ type: "web_search" }],
      stream: false,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(report).toMatchObject({
      answer: "真实来源上的原创改编",
      model: "resolved-model",
      toolCalls: 1,
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });
    expect(JSON.stringify(report)).not.toContain(config.apiKey);
  });
  it("does not claim web search from ordinary text or invented markdown links", async () => {
    const raw = result();
    raw.output = raw.output.filter((x) => x.type !== "web_search_call");
    mocks.fetch.mockResolvedValue(Response.json(raw));
    await expect(searchWebWithModel(config, "搜索")).rejects.toThrow(
      /搜索工具/
    );
    const uncited = result();
    (uncited.output[2].content![0] as { annotations?: unknown }).annotations =
      [];
    mocks.fetch.mockResolvedValue(Response.json(uncited));
    await expect(searchWebWithModel(config, "搜索")).rejects.toThrow(/引用/);
  });
  it("rejects missing capability, wrong protocol and oversized queries before a request", async () => {
    expect(webSearchTransport({ secretKey: "hidden" })).toBe("off");
    expect(validWebSearchSetting({ webSearchReasoningEffort: "invalid" })).toBe(
      false
    );
    expect(webSearchTransport({ webSearchTransport: "responses" })).toBe(
      "responses"
    );
    for (const c of [
      { ...config, extraConfig: {} },
      { ...config, protocol: "claude" as const },
    ])
      await expect(searchWebWithModel(c, "搜索")).rejects.toThrow(/联网搜索/);
    await expect(
      searchWebWithModel(config, "x".repeat(16001))
    ).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("never retries errors or exposes upstream errors and credentials", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("private upstream details", { status: 502 })
    );
    await expect(searchWebWithModel(config, "搜索")).rejects.toThrow(
      "联网搜索请求失败（HTTP 502）"
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete output and oversized responses, and leaves unknown usage null", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ ...result(), status: "incomplete" })
    );
    await expect(searchWebWithModel(config, "搜索")).rejects.toThrow(/未完整/);
    mocks.fetch.mockResolvedValue(new Response("x".repeat(2100000)));
    await expect(searchWebWithModel(config, "搜索")).rejects.toThrow(/过大/);
    mocks.fetch.mockResolvedValue(
      Response.json({ ...result(), usage: undefined })
    );
    expect(
      (await searchWebWithModel(config, "搜索")).usage.totalTokens
    ).toBeNull();
  });
});

it("forwards supported reasoning settings, filters invalid citations and deduplicates real sources", async () => {
  const raw = result();
  const content = raw.output[2].content![0] as {
    annotations: Array<{ type: string; url: string; title: string }>;
  };
  const annotation = content.annotations[0];
  content.annotations.push(
    annotation,
    {
      type: "url_citation",
      url: "https://user:password@source.example/private",
      title: "unsafe",
    },
    { type: "url_citation", url: "javascript:alert(1)", title: "unsafe" },
    {
      type: "url_citation",
      url: "http://source.example/plain",
      title: "plain",
    },
    { type: "other", url: "https://source.example/uncited", title: "other" }
  );
  mocks.fetch.mockResolvedValue(Response.json(raw));
  const report = await searchWebWithModel(
    {
      ...config,
      extraConfig: { ...config.extraConfig, webSearchReasoningEffort: "high" },
    },
    "搜索"
  );
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).reasoning).toEqual({
    effort: "high",
  });
  expect(report.sources).toHaveLength(1);
});
it("does not retry an aborted request or accept malformed provider JSON", async () => {
  mocks.fetch.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
  await expect(searchWebWithModel(config, "搜索")).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  mocks.fetch.mockResolvedValueOnce(new Response("{invalid"));
  await expect(searchWebWithModel(config, "搜索")).rejects.toThrow();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("does not trust a search test older than its provider revision", () => {
  const provider = { updatedAt: new Date("2026-11-19T10:00:00Z") };
  expect(
    searchConfigurationVerified({
      testStatus: "SUCCESS",
      lastTestedAt: new Date("2026-11-19T11:00:00Z"),
      provider,
    })
  ).toBe(true);
  expect(
    searchConfigurationVerified({
      testStatus: "SUCCESS",
      lastTestedAt: new Date("2026-11-19T09:00:00Z"),
      provider,
    })
  ).toBe(false);
  expect(
    searchConfigurationVerified({
      testStatus: "SUCCESS",
      lastTestedAt: null,
      provider,
    })
  ).toBe(false);
});
