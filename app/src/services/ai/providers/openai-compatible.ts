/**
 * OpenAI 兼容协议 Provider
 * 同时支持 LLM 和图像生成
 */

import type {
  LLMProvider,
  ImageProvider,
  AIServiceConfig,
  LLMMessage,
  ImageGenerationOptions,
} from "../types";
import { trimUrl, fetchWithError, ASPECT_RATIO_TO_SIZE } from "./base";

// 支持的图像生成模型列表
const SUPPORTED_IMAGE_MODELS = [
  "dall-e-2",
  "dall-e-3",
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "chatgpt-image-latest",
  "flux",
  "flux-schnell",
  "flux-dev",
  "flux-pro",
  "flux-1",
  "stable-diffusion",
  "sd-",
  "sdxl",
  "grok-2-image",
  "grok-3-imagegen",
  "grok-image",
  "midjourney",
  "imagen",
  "kandinsky",
  "playground",
  "ideogram",
  "recraft",
  "kolors",
  "cogview",
  "wanx",
  "jimeng",
  "doubao",
];

// 常见的 LLM 文本模型（明确不支持图像生成）
const LLM_ONLY_MODELS = [
  "gpt-3.5",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4.1",
  "claude",
  "gemini",
  "deepseek",
  "qwen",
  "llama",
  "mistral",
  "grok-2",
  "grok-3",
  "grok-4",
  "meta-llama",
  "moonshot",
  "glm",
  "mixtral",
  "phi",
];

function isImageModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return SUPPORTED_IMAGE_MODELS.some((pattern) => id.includes(pattern));
}

export function isLLMModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return LLM_ONLY_MODELS.some((pattern) => id.includes(pattern));
}

export const openaiCompatibleLLM: LLMProvider = {
  async chatCompletion(messages, config, options) {
    const baseUrl = trimUrl(config.baseUrl);
    const model = options.model || config.model;

    const response = await fetchWithError(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        }),
      },
      "LLM API error"
    );

    const data = await response.json();
    return data.choices[0].message.content;
  },
};

export const openaiCompatibleImage: ImageProvider = {
  async generateImage(options, config) {
    const { prompt, aspectRatio = "9:16" } = options;
    const { apiKey, baseUrl, model } = config;

    if (isLLMModel(model)) {
      throw new Error(
        `模型「${model}」是文本对话模型，不支持图像生成。\n` +
          `请在「设置 > AI 模型配置 > 图像生成」中选择图像生成模型，如：\n` +
          `• dall-e-3（OpenAI）\n` +
          `• gpt-image-1（OpenAI）\n` +
          `• flux-schnell（Replicate/硅基流动）`
      );
    }

    const size = ASPECT_RATIO_TO_SIZE[aspectRatio] || "1024x1024";
    const effectiveModel = model && isImageModel(model) ? model : "dall-e-3";
    const url = `${trimUrl(baseUrl)}/images/generations`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: effectiveModel,
        prompt,
        size,
        n: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const contentType = response.headers.get("content-type") || "";

      if (
        contentType.includes("text/html") ||
        errorText.trim().startsWith("<!doctype") ||
        errorText.trim().startsWith("<HTML")
      ) {
        throw new Error(
          `图像生成失败：API 地址「${baseUrl}」返回了网页而不是 API 响应。\n` +
            `可能原因：\n` +
            `1. API 地址不正确，请检查「设置 > AI 模型配置」中的 Base URL\n` +
            `2. 该 API 服务不支持图像生成接口 /images/generations\n` +
            `3. API Key 无效或已过期\n\n` +
            `正确的 OpenAI 图像生成 API 地址格式：https://api.openai.com/v1`
        );
      }

      if (
        response.status === 404 ||
        errorText.includes("invalid_value") ||
        errorText.includes("not found")
      ) {
        throw new Error(
          `图像生成失败：模型«${effectiveModel}»不可用。\n` +
            `请检查：\n` +
            `1. 您的 API 提供商是否支持该模型\n` +
            `2. 模型名称是否正确（如 dall-e-3, gpt-image-1）\n` +
            `3. 如使用中转站，请确认其支持图像生成接口`
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `图像生成失败：API 认证失败（HTTP ${response.status}）。\n` +
            `请检查：\n` +
            `1. API Key 是否正确\n` +
            `2. API Key 是否有图像生成权限\n` +
            `3. 账户余额是否充足`
        );
      }

      throw new Error(
        `Image generation error: ${response.status} ${errorText}`
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(
        `图像生成失败：API 返回了非 JSON 数据（Content-Type: ${contentType}）。\n` +
          `响应内容：${text.substring(0, 200)}${text.length > 200 ? "..." : ""}\n\n` +
          `请确认 API 地址「${baseUrl}」是有效的 OpenAI 兼容图像生成接口。`
      );
    }

    const data = await response.json();
    return data.data?.[0]?.url;
  },
};
