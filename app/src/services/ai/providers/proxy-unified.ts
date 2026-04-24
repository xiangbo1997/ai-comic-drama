/**
 * 通用中转协议 Provider
 * 适用于使用统一端点的中转站
 *
 * Stage 1.5 增强：
 * - 支持 `referenceImages`（多张参考图）。单张 `referenceImage` 作为兜底。
 * - 支持 `negativePrompt`：中转站基于 chat-completion 协议，没有原生 negative 字段，
 *   用一段清晰的自然语言注入 messages 让模型理解。
 * - 请求体附加 `size` 与 `aspect_ratio` 参数，兼容更多中转实现。
 */

import type { ImageProvider, VideoProvider } from "../types";
import { trimUrl, fetchWithError } from "./base";

/** 把 aspectRatio 映射到 OpenAI images API 的 size 字段 */
function aspectRatioToSize(aspect?: string): string {
  switch (aspect) {
    case "9:16":
      return "1024x1792";
    case "16:9":
      return "1792x1024";
    case "1:1":
    default:
      return "1024x1024";
  }
}

export const proxyUnifiedImage: ImageProvider = {
  async generateImage(options, config) {
    const {
      prompt,
      referenceImage,
      referenceImages,
      negativePrompt,
      aspectRatio,
    } = options;
    const effectiveModel = config.model || "grok-2-image";
    const url = `${trimUrl(config.baseUrl)}/chat/completions`;

    // 合并多图与单图：数组版优先；若无数组但有单张则退化为单元素数组
    const refs =
      referenceImages && referenceImages.length > 0
        ? referenceImages
        : referenceImage
          ? [referenceImage]
          : [];

    // 构造 text 指令：说明参考图作用 + 附加 negative
    const textLines: string[] = [];
    if (refs.length > 0) {
      textLines.push(
        refs.length === 1
          ? "Based on the character shown in the reference image above, generate a new image:"
          : `Based on the characters shown in the ${refs.length} reference images above, keeping their facial features and outfits consistent, generate a new image:`
      );
    }
    textLines.push(prompt);
    if (negativePrompt && negativePrompt.trim()) {
      textLines.push(
        `\n\nAvoid the following elements in the generated image: ${negativePrompt.trim()}`
      );
    }
    const finalText = textLines.join("\n");

    // 构造 messages：参考图按序作为 image_url parts；最后一个 text part 放指令
    const messages =
      refs.length > 0
        ? [
            {
              role: "user",
              content: [
                ...refs.map((url) => ({
                  type: "image_url",
                  image_url: { url },
                })),
                { type: "text", text: finalText },
              ],
            },
          ]
        : [
            {
              role: "user",
              content: finalText,
            },
          ];

    const response = await fetchWithError(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: effectiveModel,
          messages,
          stream: false,
          // 附加参数：中转站可按需消费；不支持的字段通常会被忽略
          size: aspectRatioToSize(aspectRatio),
          aspect_ratio: aspectRatio,
        }),
      },
      "中转站图像生成失败"
    );

    const data = await response.json();

    // 格式1: OpenAI 图像生成格式
    if (data.data?.[0]?.url) {
      return data.data[0].url;
    }

    // 格式2: 内容中包含 Markdown 图片链接
    if (data.choices?.[0]?.message?.content) {
      const content = data.choices[0].message.content;
      const imageMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (imageMatch) {
        return imageMatch[1];
      }
      const urlMatch = content.match(
        /(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|webp))/i
      );
      if (urlMatch) {
        return urlMatch[1];
      }
    }

    throw new Error(
      `无法解析图像生成结果，返回数据: ${JSON.stringify(data).slice(0, 200)}`
    );
  },
};

export const proxyUnifiedVideo: VideoProvider = {
  async generateVideo(options, config) {
    const {
      imageUrl,
      prompt = "gentle camera movement",
      duration = 5,
    } = options;
    const url = `${trimUrl(config.baseUrl)}/video/generations`;

    const response = await fetchWithError(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          image_url: imageUrl,
          prompt,
          duration,
        }),
      },
      "视频生成失败"
    );

    const data = await response.json();
    return data.data?.[0]?.url || data.video_url || data.url;
  },
};
