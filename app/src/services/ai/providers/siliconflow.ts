/**
 * 硅基流动 (SiliconFlow) 图像生成 Provider
 */

import type { ImageProvider } from "../types";
import { fetchWithError, ASPECT_RATIO_TO_SIZE_SF } from "./base";

export const siliconflowImage: ImageProvider = {
  async generateImage(options, config) {
    const { prompt, referenceImage, aspectRatio = "9:16" } = options;
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
        }),
      },
      "SiliconFlow image generation error"
    );

    const data = await response.json();
    return data.images?.[0]?.url || data.data?.[0]?.url;
  },
};
