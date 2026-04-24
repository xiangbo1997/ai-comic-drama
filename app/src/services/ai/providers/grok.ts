/**
 * Grok (xAI) 图像生成 Provider
 */

import type { ImageProvider } from "../types";
import { trimUrl, fetchWithError } from "./base";
import { isLLMModel } from "./openai-compatible";

export const grokImage: ImageProvider = {
  async generateImage(options, config) {
    const { prompt } = options;
    const { apiKey, baseUrl, model } = config;

    if (model && isLLMModel(model)) {
      throw new Error(
        `Grok 协议需要图像生成模型，但配置了 LLM 模型「${model}」。\n` +
        `请在「设置 > AI 模型配置 > 图像生成」中选择图像模型，如：\n` +
        `• grok-2-image\n` +
        `• grok-3-imagegen\n` +
        `或者将协议改为「通用中转」以通过对话接口生成图像。`
      );
    }

    const effectiveModel = model || "grok-2-image";
    const url = `${trimUrl(baseUrl)}/images/generations`;

    const response = await fetchWithError(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: effectiveModel,
          prompt,
          n: 1,
        }),
      },
      "Grok 图像生成失败"
    );

    const data = await response.json();
    return data.data?.[0]?.url || data.data?.[0]?.b64_json;
  },
};
