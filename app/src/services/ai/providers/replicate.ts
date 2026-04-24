/**
 * Replicate 图像生成 Provider
 */

import type { ImageProvider } from "../types";

export const replicateImage: ImageProvider = {
  async generateImage(options, config) {
    const { prompt, referenceImage, aspectRatio = "9:16" } = options;
    const { default: Replicate } = await import("replicate");
    const replicate = new Replicate({ auth: config.apiKey });

    if (referenceImage) {
      const effectiveModel = config.model || "black-forest-labs/flux-kontext-pro";
      const output = await replicate.run(effectiveModel as `${string}/${string}`, {
        input: {
          prompt,
          image_url: referenceImage,
          aspect_ratio: aspectRatio,
          safety_tolerance: 2,
          output_format: "webp",
        },
      });
      return output as unknown as string;
    }

    const effectiveModel = config.model || "black-forest-labs/flux-schnell";
    const output = await replicate.run(effectiveModel as `${string}/${string}`, {
      input: {
        prompt,
        aspect_ratio: aspectRatio,
        output_format: "webp",
      },
    });

    const result = output as string[];
    return Array.isArray(result) ? result[0] : (result as unknown as string);
  },
};
