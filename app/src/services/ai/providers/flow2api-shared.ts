/**
 * Flow2API 公共逻辑（图片 / 视频共用）
 *
 * flow2api 网关的图片与视频生成走同一条协议：
 * - 入口统一为 POST {base}/v1/chat/completions + stream:true
 * - 响应是 SSE 流：每条 `data: <JSON>\n\n`，最后 `data: [DONE]`
 * - 进度信息在 choices[0].delta.reasoning_content（含 ❌ 时代表任务失败）
 * - 最终结果在 finish_reason==='stop' 帧的 choices[0].delta.content
 *   （图片为 `![Generated Image](url)`，视频为 `<video src='...'>`）
 *
 * 本模块承载两个 provider 完全同构的部分：端点拼接、URL 绝对化、
 * multimodal content 组装、HTTP 错误映射、SSE 请求与帧解析循环。
 * 各自的最终 content 提取（图片 markdown / 视频 html）留在对应 provider。
 */

import { safeFetch } from "@/lib/url-guard";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:ai:flow2api");

/**
 * 拼接 chat/completions 端点。
 * 容错：用户在设置页把 Base URL 填成 `https://host/v1`（OpenAI 兼容习惯）
 * 或 `https://host`（本项目推荐写法）都能工作——尾部已有 /v1 时不再重复拼接。
 */
export function flow2apiChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
  return `${trimmed}/v1/chat/completions`;
}

/**
 * flow2api 上游只接受 https:// 或 data: URL，不接受相对 path。
 * 把 /uploads/... 这种 path-only 补全成公网可达的绝对地址，
 * 由 Caddy 的 file_server 直供。
 */
export function absolutizeImageUrl(url: string): string {
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

/** 将若干图像 URL + 文本指令拼成 OpenAI multimodal content（图在前，文在后） */
export function buildMultimodalContent(
  prompt: string,
  imageUrls: string[]
): unknown {
  const images: string[] = [];
  for (const u of imageUrls) {
    if (!u) continue;
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
export function describeHttpError(status: number, body: string): string {
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
      return "flow2api 上游超时（504）：生成耗时过长，请稍后重试";
    default:
      return `flow2api 请求失败（${status}）：${body.slice(0, 200)}`;
  }
}

/** 解析单条 SSE data 帧 */
interface ParsedFrame {
  reasoning?: string;
  content?: string;
  finishReason?: string | null;
  /** 顶层 error 帧（flow2api 失败时最后会吐 {"error":{...}}） */
  errorMessage?: string;
}

function parseFrame(jsonStr: string): ParsedFrame | null {
  try {
    const obj = JSON.parse(jsonStr) as {
      choices?: Array<{
        delta?: { reasoning_content?: string; content?: string };
        finish_reason?: string | null;
      }>;
      error?: { message?: string };
    };
    if (obj.error?.message) {
      return { errorMessage: obj.error.message };
    }
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

/**
 * 判断是否为「网关拉取输入图片失败」类瞬时错误。
 *
 * 场景：图片存 R2 的 pub-*.r2.dev 开发域（Cloudflare 官方限流），批量生成时
 * 网关并发抓图会被瞬时掐掉个别请求，返回 400 "Failed to load image from ..."。
 * 该 URL 几秒后即恢复可达，直接重试即可挽回，不应让整个生成任务失败。
 */
export function isTransientImageLoadError(message: string): boolean {
  return /failed to load image/i.test(message);
}

/** 瞬时抓图失败的额外重试次数与退避（毫秒） */
const IMAGE_LOAD_RETRIES = 2;
const IMAGE_LOAD_BACKOFF_MS = [3_000, 8_000];

/**
 * 发起 flow2api SSE 生成请求并读到最终结果。
 *
 * 对「网关拉取输入图片失败」的瞬时错误自动重试（最多 2 次，退避 3s/8s），
 * 其余错误原样抛出。
 *
 * @param label 日志/错误文案里的任务名（如 "图像" / "视频"）
 * @returns finish_reason==='stop' 帧的 content 原文（由调用方提取媒体 URL）
 */
export async function requestFlow2apiGeneration(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  content: unknown;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= IMAGE_LOAD_RETRIES; attempt++) {
    try {
      return await requestFlow2apiGenerationOnce(params);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (
        attempt < IMAGE_LOAD_RETRIES &&
        isTransientImageLoadError(error.message)
      ) {
        log.warn(
          `flow2api ${params.label}生成遇到瞬时抓图失败，${IMAGE_LOAD_BACKOFF_MS[attempt] / 1000}s 后重试（第 ${attempt + 1}/${IMAGE_LOAD_RETRIES} 次）`,
          { error: error.message }
        );
        await new Promise((r) => setTimeout(r, IMAGE_LOAD_BACKOFF_MS[attempt]));
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error(`flow2api ${params.label}生成失败`);
}

/** 单次 SSE 生成请求（重试语义由 requestFlow2apiGeneration 包装） */
async function requestFlow2apiGenerationOnce(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  content: unknown;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  const { baseUrl, apiKey, model, content, timeoutMs, label } = params;
  const url = flow2apiChatUrl(baseUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    // SSRF：baseUrl 用户可控，走 safeFetch（钉 IP + 禁跟随重定向）；
    // safeFetch 透传 init（含 SSE 的 signal），流式响应正常工作
    response = await safeFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: "user", content }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      throw new Error(
        `flow2api ${label}生成超时（>${Math.round(timeoutMs / 60_000)} 分钟）`
      );
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
  let finalContent: string | null = null;

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

          if (parsed.errorMessage) {
            throw new Error(`flow2api 任务失败: ${parsed.errorMessage}`);
          }

          if (parsed.reasoning) {
            const r = parsed.reasoning.trim();
            log.info(`[flow2api] ${r}`);
            // 上游失败标记有两种：❌ 前缀（旧版）与 "错误:" 前缀（当前版）
            if (r.includes("❌") || r.startsWith("错误:")) {
              throw new Error(`flow2api 任务失败: ${r}`);
            }
          }

          if (parsed.finishReason === "stop" && parsed.content) {
            finalContent = parsed.content;
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

  if (!finalContent) {
    throw new Error(`flow2api 流已结束但未收到${label}结果`);
  }

  return finalContent;
}
