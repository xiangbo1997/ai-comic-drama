/**
 * Flow2API Video Provider
 *
 * 适配 Google Labs Flow / Veo 视频生成网关。
 *
 * 协议特征：
 * - 入口统一为 POST /v1/chat/completions + stream:true
 * - 响应是 SSE 流：每条 `data: <JSON>\n\n`，最后 `data: [DONE]`
 * - 进度信息在 choices[0].delta.reasoning_content
 * - 最终视频结果在 choices[0].delta.content（finish_reason==='stop' 帧）
 *   形如 ```html\n<video src='https://...mp4' controls></video>\n```
 * - 客户端必须 stream:true，否则 Cloudflare 100s 超时；总超时建议 1800s
 *
 * 模型路由（基于输入图像数量与朝向）：
 * - T2V 横屏: veo_3_1_t2v_fast_landscape
 * - T2V 竖屏: veo_3_1_t2v_fast_portrait
 * - I2V 横屏 (1 张): veo_3_1_i2v_lite_landscape
 * - I2V 竖屏 (1 张): veo_3_1_i2v_lite_portrait
 * - I2V 首尾帧 (2 张): veo_3_1_i2v_s_fast_fl
 * - R2V 横屏 (1-3 张参考): veo_3_1_r2v_fast (无 _landscape 后缀)
 * - R2V 竖屏 (1-3 张参考): veo_3_1_r2v_fast_portrait
 *
 * 接口字段：VideoGenerationOptions 已扩展 aspectRatio / referenceImages 正式字段；
 * 仍保留对旧 `_referenceImages` 后门字段的兼容读取，方便灰度回滚。
 */

import type { VideoProvider } from "../types";
import type { VideoGenerationOptions, AIServiceConfig } from "@/types";
import { trimUrl } from "./base";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:ai:flow2api-video");

/**
 * 读取参考图与画幅。
 * 优先使用 VideoGenerationOptions 的正式字段（referenceImages / aspectRatio）；
 * 同时兼容旧的 `_referenceImages` 后门字段，便于灰度回滚。
 */
function readExtra(options: VideoGenerationOptions): {
  referenceImages: string[];
  aspectRatio: "landscape" | "portrait";
} {
  const raw = options as unknown as Record<string, unknown>;

  // 1) 优先：正式字段 referenceImages
  const officialRefs = options.referenceImages;
  let referenceImages: string[] = Array.isArray(officialRefs)
    ? officialRefs.filter(
        (s): s is string => typeof s === "string" && s.length > 0
      )
    : [];

  // 2) 后备：旧后门字段 _referenceImages（兼容外部传入）
  if (referenceImages.length === 0) {
    const legacy = raw["_referenceImages"];
    if (Array.isArray(legacy)) {
      referenceImages = legacy.filter(
        (s): s is string => typeof s === "string" && s.length > 0
      );
    }
  }

  // 3) 画幅：先看正式字段，再看 raw（兼容字符串透传）
  const aspectCandidate =
    options.aspectRatio !== undefined
      ? options.aspectRatio
      : raw["aspectRatio"];
  // 9:16 / portrait / vertical 视为竖屏；其他默认横屏
  let aspectRatio: "landscape" | "portrait" = "landscape";
  if (typeof aspectCandidate === "string") {
    const v = aspectCandidate.toLowerCase();
    if (v === "9:16" || v === "portrait" || v === "vertical") {
      aspectRatio = "portrait";
    }
  }

  return { referenceImages, aspectRatio };
}

/** 根据输入选择 Veo 模型 ID；config.model 显式指定时优先使用 */
function chooseModel(
  options: VideoGenerationOptions,
  config: AIServiceConfig
): string {
  if (config.model && config.model.trim()) {
    return config.model.trim();
  }

  const { referenceImages, aspectRatio } = readExtra(options);
  const hasMain = !!options.imageUrl;
  const refsCount = referenceImages.length;

  // 首尾帧：单一固定模型，不区分朝向（官方文档约定）
  if (hasMain && refsCount === 1) {
    return "veo_3_1_i2v_s_fast_fl";
  }

  // 多张参考图（R2V）
  if (!hasMain && refsCount >= 1) {
    return aspectRatio === "portrait"
      ? "veo_3_1_r2v_fast_portrait"
      : "veo_3_1_r2v_fast";
  }

  // 单张图（I2V Lite）
  if (hasMain && refsCount === 0) {
    return aspectRatio === "portrait"
      ? "veo_3_1_i2v_lite_portrait"
      : "veo_3_1_i2v_lite_landscape";
  }

  // 纯文本（T2V Fast）
  return aspectRatio === "portrait"
    ? "veo_3_1_t2v_fast_portrait"
    : "veo_3_1_t2v_fast_landscape";
}

/**
 * flow2api 上游只接受 https:// 或 data: URL，不接受相对 path。
 * 与 openai-compatible.ts 的 fetchImageBlob 同等逻辑：把 /uploads/... 这种 path-only
 * 补全成 https://comic.cloudsentryai.com/uploads/...，然后由 Caddy 的 file_server 直供。
 */
function absolutizeImageUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://comic.cloudsentryai.com";
  const trimmedBase = base.replace(/\/+$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${trimmedBase}${path}`;
}

/** 将所有图像 URL 拼成 multimodal content 数组 */
function buildContent(
  prompt: string,
  imageUrl: string | undefined,
  referenceImages: string[]
): unknown {
  const images: string[] = [];
  if (imageUrl) images.push(absolutizeImageUrl(imageUrl));
  for (const u of referenceImages) {
    const abs = absolutizeImageUrl(u);
    if (!images.includes(abs)) images.push(abs);
  }

  if (images.length === 0) {
    return prompt;
  }

  return [
    ...images.map((url) => ({
      type: "image_url",
      image_url: { url },
    })),
    { type: "text", text: prompt },
  ];
}

/** HTTP 状态码 → 中文友好错误 */
function describeHttpError(status: number, body: string): string {
  switch (status) {
    case 401:
      return "flow2api 鉴权失败（401）：API Key 无效或已过期";
    case 403:
      return "flow2api 拒绝访问（403）：当前账号 tier 不足以调用此模型";
    case 429:
      return "flow2api 触发限流（429）：请等待 30-60 秒后重试";
    case 500:
    case 503:
      return `flow2api 后端不可用（${status}）：上游 token 池可能暂时无可用资源`;
    case 504:
      return "flow2api 上游超时（504）：视频生成耗时过长，请稍后重试";
    default:
      return `flow2api 请求失败（${status}）：${body.slice(0, 200)}`;
  }
}

/** 解析单条 SSE data 帧 */
interface ParsedFrame {
  reasoning?: string;
  content?: string;
  finishReason?: string | null;
}

function parseFrame(jsonStr: string): ParsedFrame | null {
  try {
    const obj = JSON.parse(jsonStr) as {
      choices?: Array<{
        delta?: { reasoning_content?: string; content?: string };
        finish_reason?: string | null;
      }>;
    };
    const choice = obj.choices?.[0];
    if (!choice) return null;
    return {
      reasoning: choice.delta?.reasoning_content,
      content: choice.delta?.content,
      finishReason: choice.finish_reason ?? null,
    };
  } catch {
    return null;
  }
}

/** 从最终 content 中提取视频 URL */
function extractVideoUrl(content: string): string | null {
  const m = content.match(/<video[^>]+src=['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

/**
 * v2：拼接最终视频 prompt：
 *   identityPrompt（角色 DNA 前缀，≤200 字）+ 用户/场景 prompt
 *
 * 设计：
 * - 仅在 identityPrompt 存在时前置；避免破坏老调用方
 * - 用 ". " 分隔，保证语义边界清晰
 * - 上游 Veo 模型对前置身份描述敏感，能显著提升角色一致性
 */
function buildVideoPrompt(prompt: string, identityPrompt?: string): string {
  const cleanIdentity = identityPrompt?.trim();
  if (!cleanIdentity) return prompt;
  return `${cleanIdentity}. ${prompt}`;
}

export const flow2apiVideo: VideoProvider = {
  async generateVideo(options, config) {
    const {
      prompt = "gentle camera movement",
      imageUrl,
      identityPrompt,
      seed,
    } = options;
    const { referenceImages } = readExtra(options);
    const model = chooseModel(options, config);
    const url = `${trimUrl(config.baseUrl)}/v1/chat/completions`;

    // v2：在调用上游前拼"身份前缀 + 镜头描述"
    const finalPrompt = buildVideoPrompt(prompt, identityPrompt);

    log.info("[flow2api] start", {
      model,
      hasMain: !!imageUrl,
      hasIdentityPrompt: !!identityPrompt,
      hasSeed: typeof seed === "number",
      refsCount: referenceImages.length,
      promptLen: finalPrompt.length,
      seed,
    });

    const controller = new AbortController();
    const timeoutMs = 1800_000; // 30 分钟
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            {
              role: "user",
              content: buildContent(finalPrompt, imageUrl, referenceImages),
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new Error("flow2api 视频生成超时（>30 分钟）");
      }
      throw new Error(`flow2api 网络请求失败: ${(err as Error).message}`);
    }

    if (!response.ok) {
      clearTimeout(timer);
      let body = "";
      try {
        body = await response.text();
      } catch {
        // ignore
      }
      throw new Error(describeHttpError(response.status, body));
    }

    if (!response.body) {
      clearTimeout(timer);
      throw new Error("flow2api 响应体为空，无法读取 SSE 流");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let videoUrl: string | null = null;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 按 SSE 帧分割（双换行）
        let sepIdx: number;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const rawFrame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);

          // 跳过空帧
          if (!rawFrame.trim()) continue;

          // SSE 行：去掉 "data: " 前缀（可能多行，但 flow2api 单行）
          const lines = rawFrame.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") {
              // 流结束标记
              continue;
            }
            const parsed = parseFrame(payload);
            if (!parsed) continue;

            if (parsed.reasoning) {
              const r = parsed.reasoning.trim();
              log.info(`[flow2api] ${r}`);
              if (r.includes("❌")) {
                throw new Error(`flow2api 任务失败: ${r}`);
              }
            }

            if (parsed.finishReason === "stop" && parsed.content) {
              const u = extractVideoUrl(parsed.content);
              if (u) {
                videoUrl = u;
              } else {
                throw new Error(
                  `flow2api 收到 stop 帧但未能解析视频 URL: ${parsed.content.slice(
                    0,
                    200
                  )}`
                );
              }
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    if (!videoUrl) {
      throw new Error("flow2api 流已结束但未收到视频 URL");
    }

    log.info("[flow2api] done", { videoUrl });
    return videoUrl;
  },
};
