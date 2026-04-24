/**
 * Runway 视频生成 Provider
 */

import type { VideoProvider } from "../types";
import { fetchWithError } from "./base";

export const runwayVideo: VideoProvider = {
  async generateVideo(options, config) {
    const {
      imageUrl,
      prompt = "gentle camera movement",
      duration = 5,
    } = options;
    const apiKey = config.apiKey;

    if (!apiKey) {
      throw new Error("未配置视频生成服务，请在 AI 模型配置页面添加配置");
    }

    const response = await fetchWithError(
      "https://api.dev.runwayml.com/v1/image_to_video",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Runway-Version": "2024-11-06",
        },
        body: JSON.stringify({
          model: "gen3a_turbo",
          promptImage: imageUrl,
          promptText: prompt,
          duration,
          ratio: "9:16",
        }),
      },
      "Runway API error"
    );

    const { id: taskId } = await response.json();

    while (true) {
      const statusResponse = await fetch(
        `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const result = await statusResponse.json();

      if (result.status === "SUCCEEDED") {
        return result.output[0];
      }
      if (result.status === "FAILED") {
        throw new Error("Runway 视频生成失败");
      }

      await new Promise((r) => setTimeout(r, 5000));
    }
  },
};
