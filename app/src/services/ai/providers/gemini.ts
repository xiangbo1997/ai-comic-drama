/**
 * Gemini LLM Provider
 */

import type { LLMProvider } from "../types";
import { trimUrl, fetchWithError, pluckPath } from "./base";
import { TruncatedOutputError } from "../errors";

export const geminiLLM: LLMProvider = {
  async chatCompletion(messages, config, options) {
    const baseUrl =
      trimUrl(config.baseUrl) ||
      "https://generativelanguage.googleapis.com/v1beta";
    const model = options.model || config.model;
    const url = `${baseUrl}/models/${model}:generateContent?key=${config.apiKey}`;

    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const systemMessage = messages.find((m) => m.role === "system");

    const response = await fetchWithError(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: systemMessage
            ? { parts: [{ text: systemMessage.content }] }
            : undefined,
        }),
      },
      "Gemini API error"
    );

    const data = await response.json();
    // 安全取值：Gemini 命中 SAFETY/RECITATION 阻断时 candidates 常为空或缺 parts，
    // 四层裸下标必崩；pluckPath 在缺失处给可读错误（含 finishReason 片段）
    const text = pluckPath<string>(
      data,
      ["candidates", 0, "content", "parts", 0, "text"],
      "Gemini 对话响应"
    );

    // 截断检测：Gemini 的对应信号是 finishReason==="MAX_TOKENS"（语义同 OpenAI
    // 的 "length"）。见 errors.ts 说明——不抛错则上层会拿半截 JSON 原样重试。
    const finishReason = (
      data as { candidates?: Array<{ finishReason?: string | null }> }
    )?.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      throw new TruncatedOutputError({
        finishReason,
        requestedMaxTokens: options.maxTokens,
        partialContent: text,
      });
    }

    return text;
  },
};
