/**
 * Runway 视频生成 Provider
 */

import type { VideoProvider } from "../types";
import { fetchWithError, pluckPath } from "./base";
import { pollUntilDone, type PollStep } from "./poll";
import { nearestVideoDuration } from "@/services/generation/video-segmenter";

/** Runway gen3a_turbo 接受的时长档位（秒） */
const RUNWAY_DURATIONS = [5, 10] as const;

export const runwayVideo: VideoProvider = {
  async generateVideo(options, config) {
    const { imageUrl, prompt = "gentle camera movement" } = options;
    // 请求时长就近吸附到 Runway 合法档位，防越界值直达上游 API
    const duration = nearestVideoDuration(options.duration, RUNWAY_DURATIONS);
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
      "Runway API error",
      "submit" // 非幂等视频生成提交（提交后返回 taskId 再轮询）：只重试 429/连接前失败，防重复提交
    );

    const { id: taskId } = await response.json();
    // 防呆：提交失败时 id 为 undefined，会轮询 /tasks/undefined 静默走错
    if (!taskId) {
      throw new Error(
        "Runway 视频生成提交失败：响应缺少任务 id（可能是 API Key 无效或上游拒绝请求）"
      );
    }

    // 轮询任务状态：间隔 5s，超时上限 10 分钟（防止上游卡死无限挂起）
    const step = async (): Promise<PollStep<string>> => {
      const statusResponse = await fetch(
        `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const result = await statusResponse.json();

      if (result.status === "SUCCEEDED") {
        // 安全取值：标记 SUCCEEDED 但 output 缺失/为空（中转站非标准实现）时裸下标会崩
        const output = pluckPath<string>(
          result,
          ["output", 0],
          "Runway 视频结果"
        );
        return { done: true, result: output };
      }
      if (result.status === "FAILED") {
        const detail =
          typeof result.failure === "string"
            ? `: ${result.failure}`
            : result.failureCode
              ? `: ${result.failureCode}`
              : "";
        return { failed: true, reason: `Runway 视频生成失败${detail}` };
      }
      return { pending: true };
    };

    return pollUntilDone(step, {
      intervalMs: 5000,
      timeoutMs: 600_000,
      timeoutLabel: "Runway 视频生成",
    });
  },
};
