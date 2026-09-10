/**
 * Grok (xAI) 图像生成 Provider
 */

import type { ImageProvider } from "../types";
import { trimUrl, fetchWithError } from "./base";
import { isLikelyWrongCategoryModel } from "./openai-compatible";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai:provider:grok");

export const grokImage: ImageProvider = {
  async generateImage(options, config, requestOptions) {
    const { prompt } = options;
    const { apiKey, baseUrl, model } = config;

    // 软告警而非硬阻断，理由同 openai-compatible.generateImage
    if (model && isLikelyWrongCategoryModel(model)) {
      log.warn(
        `模型「${model}」看起来像文本对话模型，但仍按 Grok 图像生成请求发出；` +
          `若上游报错，请确认「设置 > AI 模型配置 > 图像生成」的模型选择`
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
        signal: requestOptions?.signal,
      },
      "Grok 图像生成失败",
      "submit" // 非幂等图像生成提交：只重试 429/连接前失败，防重复出图浪费上游配额
    );

    const data = await response.json();
    return data.data?.[0]?.url || data.data?.[0]?.b64_json;
  },
};
