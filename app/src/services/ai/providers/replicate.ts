/**
 * Replicate 图像生成 Provider
 */

import type { ImageProvider } from "../types";

export const replicateImage: ImageProvider = {
  async generateImage(options, config) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new Error(
        "Replicate API Key 未配置或为空。请前往「设置 > AI 模型配置 > 图像生成」补全 Replicate Provider 的 API Key。"
      );
    }

    const { prompt, referenceImage, aspectRatio = "9:16", seed } = options;
    const { default: Replicate } = await import("replicate");
    const replicate = new Replicate({ auth: config.apiKey });

    if (referenceImage) {
      const effectiveModel =
        config.model || "black-forest-labs/flux-kontext-pro";
      const output = await replicate.run(
        effectiveModel as `${string}/${string}`,
        {
          input: {
            prompt,
            image_url: referenceImage,
            aspect_ratio: aspectRatio,
            safety_tolerance: 2,
            output_format: "webp",
            ...(typeof seed === "number" ? { seed } : {}),
          },
        }
      );
      return output as unknown as string;
    }

    const effectiveModel = config.model || "black-forest-labs/flux-schnell";
    const output = await replicate.run(
      effectiveModel as `${string}/${string}`,
      {
        input: {
          prompt,
          aspect_ratio: aspectRatio,
          output_format: "webp",
          ...(typeof seed === "number" ? { seed } : {}),
        },
      }
    );

    const result = output as string[];
    return Array.isArray(result) ? result[0] : (result as unknown as string);
  },
};
