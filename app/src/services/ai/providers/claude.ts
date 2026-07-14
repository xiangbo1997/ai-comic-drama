/**
 * Claude (Anthropic) LLM Provider
 */

import type { LLMProvider } from "../types";
import { trimUrl, fetchWithError, pluckPath } from "./base";

export const claudeLLM: LLMProvider = {
  async chatCompletion(messages, config, options) {
    const baseUrl = trimUrl(config.baseUrl) || "https://api.anthropic.com/v1";
    const model = options.model || config.model;

    // Claude 不支持 system 作为消息角色
    const systemMessage = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const response = await fetchWithError(
      `${baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: options.maxTokens,
          system: systemMessage?.content,
          messages: otherMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      },
      "Claude API error"
    );

    const data = await response.json();
    // 安全取值：Claude 触发 content_filter 或返回 error 对象时无 content 数组，
    // 裸下标会崩；pluckPath 在缺失处给可读错误
    return pluckPath<string>(data, ["content", 0, "text"], "Claude 对话响应");
  },
};
