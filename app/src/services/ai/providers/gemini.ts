/**
 * Gemini LLM Provider
 */

import type { LLMProvider } from "../types";
import { trimUrl, fetchWithError } from "./base";

export const geminiLLM: LLMProvider = {
  async chatCompletion(messages, config, options) {
    const baseUrl = trimUrl(config.baseUrl) || "https://generativelanguage.googleapis.com/v1beta";
    const model = options.model || config.model;
    const url = `${baseUrl}/models/${model}:generateContent?key=${config.apiKey}`;

    const contents = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const systemMessage = messages.find(m => m.role === "system");

    const response = await fetchWithError(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
        }),
      },
      "Gemini API error"
    );

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  },
};
