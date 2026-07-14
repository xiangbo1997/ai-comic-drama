/**
 * 硅基流动 (SiliconFlow) 图像生成 Provider
 */

import type { ImageProvider } from "../types";
import { fetchWithError, ASPECT_RATIO_TO_SIZE_SF } from "./base";

export const siliconflowImage: ImageProvider = {
  async generateImage(options, config) {
    const {
      prompt,
      referenceImage,
      aspectRatio = "9:16",
      seed,
      negativePrompt,
    } = options;
    const { apiKey, baseUrl, model } = config;
    const effectiveModel = model || "black-forest-labs/FLUX.1-schnell";
    const size = ASPECT_RATIO_TO_SIZE_SF[aspectRatio] || "1024x1024";

    const response = await fetchWithError(
      `${baseUrl}/images/generations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: effectiveModel,
          prompt: referenceImage
            ? `${prompt} [Reference: ${referenceImage}]`
            : prompt,
          image_size: size,
          num_inference_steps: 20,
          ...(typeof seed === "number" ? { seed } : {}),
          // SiliconFlow FLUX 系列支持 negative_prompt；非空才传
          ...(negativePrompt && negativePrompt.trim()
            ? { negative_prompt: negativePrompt.trim() }
            : {}),
        }),
      },
      "SiliconFlow image generation error",
      "submit" // 非幂等图像生成提交：只重试 429/连接前失败，防重复出图浪费上游配额
    );

    const data = await response.json();
    return data.images?.[0]?.url || data.data?.[0]?.url;
  },
};
