import { z } from "zod";
import type { AIServiceConfig } from "@/types";
import { safeFetch } from "@/lib/url-guard";
import { observeLLM } from "@/lib/observability/langfuse";
import { webSearchTransport, WebSearchResultZ } from "@/lib/ai-web-search";

const NativeResponseZ = z.object({
  id: z.string().optional(),
  status: z.string(),
  model: z.string().optional(),
  output: z.array(
    z.object({
      type: z.string(),
      status: z.string().optional(),
      role: z.string().optional(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            annotations: z
              .array(
                z.object({
                  type: z.string(),
                  url: z.string().optional(),
                  title: z.string().optional(),
                })
              )
              .optional(),
          })
        )
        .optional(),
    })
  ),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .nullish(),
});

export async function searchWebWithModel(
  config: AIServiceConfig,
  query: string
) {
  z.string().trim().min(1).max(16000).parse(query);
  if (
    config.protocol !== "openai" ||
    webSearchTransport(config.extraConfig) !== "responses"
  )
    throw new Error("请在共用模型设置中为此文字配置启用并测试联网搜索能力");
  return observeLLM(
    {
      name: "model_web_search",
      model: config.model,
      input: query,
      metadata: { transport: "responses", retries: 0 },
      tags: ["llm", "web-search"],
    },
    async () => {
      // 原生工具记录和引用均需真实返回；普通对话中的链接不算已执行搜索。
      const response = await safeFetch(
        config.baseUrl.replace(/\/+$/, "") + "/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            input: [{ role: "user", content: query }],
            tools: [{ type: "web_search" }],
            stream: false,
            ...(["low", "medium", "high"].includes(
              config.extraConfig?.webSearchReasoningEffort || ""
            )
              ? {
                  reasoning: {
                    effort: config.extraConfig!.webSearchReasoningEffort,
                  },
                }
              : {}),
            max_output_tokens: 9000,
          }),
          signal: AbortSignal.timeout(180000),
        }
      );
      if (!response.ok || !response.body)
        throw new Error(`联网搜索请求失败（HTTP ${response.status}）`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2097152) {
            await reader.cancel();
            throw new Error("联网搜索响应过大");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = NativeResponseZ.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8"))
      );
      if (data.status !== "completed")
        throw new Error("联网搜索未完整结束，不自动重试原请求");
      const toolCalls = data.output.filter(
        (o) => o.type === "web_search_call" && o.status === "completed"
      ).length;
      if (!toolCalls)
        throw new Error(
          "模型未返回已完成的搜索工具记录，不能标记为联网搜索成功"
        );
      const message = data.output
        .filter((o) => o.type === "message" && o.role === "assistant")
        .at(-1);
      const content =
        message?.content?.filter((c) => c.type === "output_text") ?? [];
      const sources = content
        .flatMap((c) => c.annotations ?? [])
        .flatMap((a) => {
          if (
            a.type !== "url_citation" ||
            !a.url ||
            !/^https:\/\//i.test(a.url)
          )
            return [];
          try {
            const url = new URL(a.url);
            if (url.username || url.password) return [];
          } catch {
            return [];
          }
          return [{ title: (a.title || a.url).slice(0, 500), url: a.url }];
        })
        .filter((s, i, all) => all.findIndex((x) => x.url === s.url) === i);
      if (!sources.length)
        throw new Error(
          "模型未返回可核对的来源引用，不把无出处回答当成搜索结果"
        );
      const tokens = (n: number | undefined) =>
        Number.isSafeInteger(n) && n! >= 0 ? n! : null;
      return WebSearchResultZ.parse({
        answer: content.map((c) => c.text || "").join("\n"),
        responseId: data.id ?? null,
        model: data.model || config.model,
        retrievedAt: new Date().toISOString(),
        toolCalls,
        sources,
        usage: {
          inputTokens: tokens(data.usage?.input_tokens),
          outputTokens: tokens(data.usage?.output_tokens),
          totalTokens: tokens(data.usage?.total_tokens),
        },
      });
    },
    (result) => ({
      output: result.answer,
      usage: { totalTokens: result.usage.totalTokens ?? undefined },
    })
  );
}
