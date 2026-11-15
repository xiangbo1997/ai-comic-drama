import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { safeFetch } from "@/lib/url-guard";
import { observeLLM } from "@/lib/observability/langfuse";
import type { AIServiceConfig, LLMMessage } from "@/types";
import { createAssistantTools } from "./assistant-tools";
import { resolveAssistantIntent } from "@/lib/assistant-intent";
import { AssistantModelTimeoutError } from "@/lib/assistant-errors";
import { createLogger } from "@/lib/logger";

const log = createLogger("assistant-agent");

export async function runAssistantAgent(input: {
  messages: LLMMessage[];
  config: AIServiceConfig;
  userId: string;
  projectId?: string;
  seriesId?: string | null;
  requestId: string;
  request?: {
    content: string;
    history: Array<{ role: string; content: string }>;
  };
}) {
  const { config } = input;
  const request = input.request ?? {
    content: input.messages.at(-1)?.content ?? "",
    history: [],
  };
  const { tools, receipts, sources, shouldStop } = createAssistantTools({
    ...input,
    intent: resolveAssistantIntent(request.content, request.history),
  });
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(75_000);
  let steps = 0;
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
          abortSignal: signal,
          // 配乐/制作计划有完整回执，无需再总结；文字编辑仍允许多步继续完成。
          stopWhen: [stepCountIs(6), () => shouldStop?.() === true],
          // 最后一轮必须总结；禁用并行写入以保留明确的工具执行顺序。
          prepareStep: ({ stepNumber }) =>
            stepNumber === 5 ? { toolChoice: "none" } : {},
          providerOptions: { openai: { parallelToolCalls: false } },
          onStepFinish: (step) => {
            log.info("助手步骤完成", {
              requestId: input.requestId,
              step: ++steps,
              toolCalls: step.toolCalls.length,
              savedOperations: receipts.length,
              elapsedMs: Date.now() - startedAt,
            });
          },
        });
        return shouldStop?.() || (!response.text.trim() && receipts.length)
          ? "本次操作结果已保存，详情见下方操作记录。"
          : response.text.trim();
      } catch (error) {
        // 只记录有限元数据，绝不输出供应商异常正文、URL、密钥或作品提示词。
        const name =
          error instanceof Error &&
          [
            "AbortError",
            "TimeoutError",
            "AI_APICallError",
            "AI_RetryError",
          ].includes(error.name)
            ? error.name
            : "Error";
        log.warn("助手模型调用未完成", {
          requestId: input.requestId,
          protocol: config.protocol,
          elapsedMs: Date.now() - startedAt,
          errorType: signal.aborted ? "TimeoutError" : name,
          savedOperations: receipts.length,
        });
        // 已完成的写入不能因总结模型失败被说成未执行，回执仍持久保存到对话。
        if (!receipts.length) {
          if (signal.aborted || name === "TimeoutError")
            throw new AssistantModelTimeoutError();
          throw error;
        }
        return "本次已保存的操作结果如下，请以操作记录为准。";
      }
    },
    (output) => ({ output })
  );
  const receiptText = receipts.length
    ? `\n\n操作记录：\n${receipts.map((value) => `- ${value}`).join("\n")}`
    : "";
  return { content: `${result}${receiptText}`.trim(), sources };
}
