/**
 * Kling（可灵）视频生成 Provider。
 *
 * 支持官方 API Key，以及旧版 Access Key + Secret Key 签发 HS256 JWT，
 * 生成请求本身是异步任务：提交 image2video 后轮询任务详情取得视频 URL。
 */

import { createHmac } from "node:crypto";
import type { VideoProvider } from "../types";
import { trimUrl, fetchWithError } from "./base";
import { pollUntilDone, type PollStep } from "./poll";
import { nearestVideoDuration } from "@/services/generation/video-segmenter";

const KLING_API_VERSION = "/v1";
const KLING_DURATIONS = [5, 10] as const;
const KLING_DEFAULT_BASE_URL = "https://api-beijing.klingai.com";
const KLING_POLL_INTERVAL_MS = 5_000;
const KLING_POLL_TIMEOUT_MS = 600_000;

type KlingExtraConfig = Record<string, string> | undefined;

/**
 * 生成 Kling 官方要求的 JWT。
 * exp/nbf 的时间窗口与文档保持一致：有效期 30 分钟，允许 5 秒时钟偏差。
 */
export function createKlingJwt(
  accessKey: string,
  secretKey: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const encode = (value: Record<string, string | number>): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: accessKey,
    exp: nowSeconds + 1_800,
    nbf: nowSeconds - 5,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", secretKey)
    .update(unsignedToken)
    .digest("base64url");
  return `${unsignedToken}.${signature}`;
}

/** 从配置中读取 Kling 凭据，兼容早期把 Access Key 放进 extraConfig 的配置。 */
export function resolveKlingCredentials(config: {
  apiKey: string;
  extraConfig?: KlingExtraConfig;
}): { accessKey: string; secretKey: string } {
  return {
    accessKey:
      config.apiKey.trim() || config.extraConfig?.accessKey?.trim() || "",
    secretKey: config.extraConfig?.secretKey?.trim() || "",
  };
}

export function klingUrl(baseUrl: string, path: string): string {
  const root = trimUrl(baseUrl || KLING_DEFAULT_BASE_URL);
  return `${root.endsWith(KLING_API_VERSION) ? root : `${root}${KLING_API_VERSION}`}${path}`;
}

/** Secret Key 非空时使用旧版 AK/SK，否则直接使用控制台 API Key。 */
export function createKlingAuthorization(config: {
  apiKey: string;
  extraConfig?: KlingExtraConfig;
}): string {
  const { accessKey, secretKey } = resolveKlingCredentials(config);
  if (!accessKey) throw new Error("未配置 Kling API Key 或 Access Key");
  return `Bearer ${secretKey ? createKlingJwt(accessKey, secretKey) : accessKey}`;
}

function parseKlingError(data: unknown): string {
  if (!data || typeof data !== "object") return "未知错误";
  const record = data as Record<string, unknown>;
  const message = record.message ?? record.msg;
  return typeof message === "string"
    ? message
    : JSON.stringify(data).slice(0, 300);
}

function assertKlingSuccess(
  data: unknown,
  label: string
): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    throw new Error(`Kling ${label}响应格式异常`);
  }
  const record = data as Record<string, unknown>;
  if (record.code !== 0) {
    throw new Error(`Kling ${label}失败：${parseKlingError(record)}`);
  }
  const payload = record.data;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Kling ${label}响应缺少 data：${parseKlingError(record)}`);
  }
  return payload as Record<string, unknown>;
}

function getKlingVideoUrl(payload: Record<string, unknown>): string {
  const taskResult = payload.task_result;
  if (taskResult && typeof taskResult === "object") {
    const result = taskResult as Record<string, unknown>;
    const videos = result.videos;
    if (Array.isArray(videos) && videos[0] && typeof videos[0] === "object") {
      const url = (videos[0] as Record<string, unknown>).url;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
    }
  }
  throw new Error("Kling 视频生成完成但响应缺少视频 URL");
}

export const klingVideo: VideoProvider = {
  async generateVideo(options, config, requestOptions) {
    const signal = requestOptions?.signal;
    const duration = nearestVideoDuration(options.duration, KLING_DURATIONS);
    const authorization = createKlingAuthorization(config);
    const mode = config.extraConfig?.mode?.trim() || "std";
    if (!["std", "pro"].includes(mode)) {
      throw new Error("Kling 生成模式必须为 std 或 pro");
    }
    const prompt = [
      options.identityPrompt?.trim(),
      options.prompt?.trim() || "gentle camera movement",
    ]
      .filter(Boolean)
      .join("\n");
    const baseUrl = config.baseUrl || KLING_DEFAULT_BASE_URL;
    const submitResponse = await fetchWithError(
      klingUrl(baseUrl, "/videos/image2video"),
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_name: config.model || "kling-v2-6",
          image: options.imageUrl,
          prompt,
          mode,
          duration: String(duration),
        }),
        signal,
      },
      "Kling 视频生成提交失败",
      "submit"
    );
    const submitData = assertKlingSuccess(
      await submitResponse.json(),
      "视频生成提交"
    );
    const taskId = submitData.task_id;
    if (typeof taskId !== "string" || !taskId) {
      throw new Error("Kling 视频生成提交失败：响应缺少任务 id");
    }

    const step = async (): Promise<PollStep<string>> => {
      const response = await fetchWithError(
        klingUrl(baseUrl, `/videos/image2video/${encodeURIComponent(taskId)}`),
        {
          headers: {
            Authorization: createKlingAuthorization(config),
          },
          signal,
        },
        "Kling 视频任务查询失败"
      );
      const payload = assertKlingSuccess(await response.json(), "视频任务查询");
      const status = String(payload.task_status || "").toLowerCase();
      if (status === "succeed") {
        return { done: true, result: getKlingVideoUrl(payload) };
      }
      if (status === "failed") {
        const detail =
          typeof payload.task_status_msg === "string"
            ? `：${payload.task_status_msg}`
            : "";
        return { failed: true, reason: `Kling 视频生成失败${detail}` };
      }
      if (!["submitted", "processing"].includes(status)) {
        throw new Error("Kling 视频任务响应缺少有效任务状态");
      }
      return { pending: true };
    };

    return pollUntilDone(step, {
      intervalMs: KLING_POLL_INTERVAL_MS,
      timeoutMs: KLING_POLL_TIMEOUT_MS,
      timeoutLabel: "Kling 视频生成",
      signal,
    });
  },
};
