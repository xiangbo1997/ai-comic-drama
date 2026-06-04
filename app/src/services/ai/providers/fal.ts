/**
 * Fal.ai 图像和视频生成 Provider
 */

import type { ImageProvider, VideoProvider } from "../types";
import { pollUntilDone, type PollStep } from "./poll";

const FAL_QUEUE_BASE = "https://queue.fal.run";

/**
 * Fal.ai 队列轮询：提交后按 requestId 轮询状态，完成则拉取结果 JSON。
 *
 * 统一了原先图像/视频两处逐行重复的 while(true) 轮询：
 * - 增加超时上限（经 pollUntilDone，防止上游卡死无限挂起）；
 * - 失败时尽量带上上游错误详情，而非笼统的"任务失败"。
 */
async function falPollResult(
  model: string,
  requestId: string,
  apiKey: string,
  options: { intervalMs?: number; timeoutMs?: number; label: string }
): Promise<Record<string, unknown>> {
  const headers = { Authorization: `Key ${apiKey}` };

  const step = async (): Promise<PollStep<Record<string, unknown>>> => {
    const statusResponse = await fetch(
      `${FAL_QUEUE_BASE}/${model}/requests/${requestId}/status`,
      { headers }
    );
    const status = await statusResponse.json();

    if (status.status === "COMPLETED") {
      const resultResponse = await fetch(
        `${FAL_QUEUE_BASE}/${model}/requests/${requestId}`,
        { headers }
      );
      const result = (await resultResponse.json()) as Record<string, unknown>;
      return { done: true, result };
    }

    if (status.status === "FAILED") {
      // 尽量保留上游错误详情，便于排查
      const detail =
        typeof status.error === "string"
          ? `: ${status.error}`
          : status.logs
            ? `: ${JSON.stringify(status.logs).slice(0, 200)}`
            : "";
      return { failed: true, reason: `${options.label}失败${detail}` };
    }

    return { pending: true };
  };

  return pollUntilDone(step, {
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
    timeoutLabel: options.label,
  });
}

export const falImage: ImageProvider = {
  async generateImage(options, config) {
    const { prompt, referenceImage, aspectRatio = "9:16", seed } = options;
    const effectiveModel = config.model || "fal-ai/flux/schnell";

    const response = await fetch(`${FAL_QUEUE_BASE}/${effectiveModel}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_url: referenceImage,
        image_size:
          aspectRatio === "9:16"
            ? "portrait_16_9"
            : aspectRatio === "16:9"
              ? "landscape_16_9"
              : "square",
        num_images: 1,
        ...(typeof seed === "number" ? { seed } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Fal.ai image generation error: ${response.status} ${errorText}`
      );
    }

    const { request_id } = await response.json();
    const result = await falPollResult(
      effectiveModel,
      request_id,
      config.apiKey,
      {
        intervalMs: 2000,
        label: "Fal.ai 图像生成",
      }
    );
    return (
      (result as { images?: Array<{ url: string }> }).images?.[0]?.url ?? ""
    );
  },
};

export const falVideo: VideoProvider = {
  async generateVideo(options, config) {
    const {
      imageUrl,
      prompt = "gentle camera movement",
      duration = 5,
    } = options;
    const model = config.model || "fal-ai/minimax/video-01-live/image-to-video";

    const response = await fetch(`${FAL_QUEUE_BASE}/${model}`, {
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
    // 视频生成更慢：轮询间隔 5s，超时上限 10 分钟
    const result = await falPollResult(model, request_id, config.apiKey, {
      intervalMs: 5000,
      timeoutMs: 600_000,
      label: "Fal.ai 视频生成",
    });
    const video = result as {
      video?: { url?: string };
      output?: { url?: string };
    };
    const url = video.video?.url || video.output?.url;
    if (!url) {
      throw new Error("Fal.ai 视频生成完成但响应缺少视频 URL");
    }
    return url;
  },
};
