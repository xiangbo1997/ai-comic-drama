/**
 * Fal.ai 图像和视频生成 Provider
 */

import type { ImageProvider, VideoProvider, AIServiceConfig } from "../types";

/** Fal.ai 队列轮询等待结果 */
async function falPollResult(model: string, requestId: string, apiKey: string): Promise<Record<string, unknown>> {
  while (true) {
    const statusResponse = await fetch(`https://queue.fal.run/${model}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    const status = await statusResponse.json();

    if (status.status === "COMPLETED") {
      const resultResponse = await fetch(`https://queue.fal.run/${model}/requests/${requestId}`, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      return resultResponse.json();
    }

    if (status.status === "FAILED") {
      throw new Error(`Fal.ai 任务失败`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

export const falImage: ImageProvider = {
  async generateImage(options, config) {
    const { prompt, referenceImage, aspectRatio = "9:16" } = options;
    const effectiveModel = config.model || "fal-ai/flux/schnell";

    const response = await fetch(`https://queue.fal.run/${effectiveModel}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_url: referenceImage,
        image_size: aspectRatio === "9:16" ? "portrait_16_9" : aspectRatio === "16:9" ? "landscape_16_9" : "square",
        num_images: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fal.ai image generation error: ${response.status} ${errorText}`);
    }

    const { request_id } = await response.json();
    const result = await falPollResult(effectiveModel, request_id, config.apiKey);
    return (result as { images?: Array<{ url: string }> }).images?.[0]?.url ?? "";
  },
};

export const falVideo: VideoProvider = {
  async generateVideo(options, config) {
    const { imageUrl, prompt = "gentle camera movement", duration = 5 } = options;
    const model = config.model || "fal-ai/minimax/video-01-live/image-to-video";

    const response = await fetch(`https://queue.fal.run/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt,
        duration,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fal.ai 视频生成错误: ${response.status} ${errorText}`);
    }

    const { request_id } = await response.json();

    while (true) {
      const statusResponse = await fetch(`https://queue.fal.run/${model}/requests/${request_id}/status`, {
        headers: { Authorization: `Key ${config.apiKey}` },
      });
      const status = await statusResponse.json();

      if (status.status === "COMPLETED") {
        const resultResponse = await fetch(`https://queue.fal.run/${model}/requests/${request_id}`, {
          headers: { Authorization: `Key ${config.apiKey}` },
        });
        const result = await resultResponse.json();
        return result.video?.url || result.output?.url;
      }

      if (status.status === "FAILED") {
        throw new Error("Fal.ai 视频生成失败");
      }

      await new Promise((r) => setTimeout(r, 5000));
    }
  },
};
