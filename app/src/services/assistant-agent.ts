import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { safeFetch } from "@/lib/url-guard";
import { observeLLM } from "@/lib/observability/langfuse";
import type { AIServiceConfig, LLMMessage } from "@/types";
import { createAssistantTools } from "./assistant-tools";

export async function runAssistantAgent(input: {
  messages: LLMMessage[];
  config: AIServiceConfig;
  userId: string;
  projectId?: string;
  seriesId?: string | null;
  requestId: string;
}) {
  const { config } = input;
  const { tools, receipts, sources } = createAssistantTools(input);
  // 与原有模型请求共享 DNS 钉住和 SSRF 校验，SDK 禁用自动重试。
  const guardedFetch: typeof fetch = (url, init) =>
    safeFetch(String(url), init);
  const settings = {
    apiKey: config.apiKey,
    baseURL: config.baseUrl?.replace(/\/+$/, "") || undefined,
    fetch: guardedFetch,
  };
  const model =
    config.protocol === "claude"
      ? createAnthropic(settings)(config.model)
      : config.protocol === "gemini"
        ? createGoogleGenerativeAI(settings)(config.model)
        : createOpenAI(settings).chat(config.model);
  const result = await observeLLM(
    {
      name: "project_assistant",
      model: config.model,
      input: input.messages,
      metadata: { protocol: config.protocol, maxSteps: 6 },
      tags: ["llm", "assistant"],
    },
    async () => {
      try {
        const response = await generateText({
          model,
          messages: input.messages as ModelMessage[],
          tools,
          maxOutputTokens: 2048,
          temperature: 0.5,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(75_000),
          stopWhen: stepCountIs(6),
          // 最后一轮必须总结；禁用并行写入以保留明确的工具执行顺序。
          prepareStep: ({ stepNumber }) =>
            stepNumber === 5 ? { toolChoice: "none" } : {},
          providerOptions: { openai: { parallelToolCalls: false } },
        });
        return response.text.trim();
      } catch (error) {
        // 已完成的写入不能因总结模型失败被说成未执行，回执仍持久保存到对话。
        if (!receipts.length) throw error;
        return "后续回复生成失败，以下操作已完成，请检查当前作品。";
      }
    },
    (output) => ({ output })
  );
  const receiptText = receipts.length
    ? `\n\n操作记录：\n${receipts.map((value) => `- ${value}`).join("\n")}`
    : "";
  return { content: `${result}${receiptText}`.trim(), sources };
}
