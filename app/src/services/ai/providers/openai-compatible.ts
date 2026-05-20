/**
 * OpenAI 兼容协议 Provider
 * 同时支持 LLM 和图像生成
 */

import type { LLMProvider, ImageProvider } from "../types";
import { trimUrl, fetchWithError, ASPECT_RATIO_TO_SIZE } from "./base";

// 支持的图像生成模型列表
const SUPPORTED_IMAGE_MODELS = [
  "dall-e-2",
  "dall-e-3",
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "gpt-image-2",
  "codex-gpt-image-2",
  "chatgpt-image-latest",
  "flux",
  "flux-schnell",
  "flux-dev",
  "flux-pro",
  "flux-1",
  "stable-diffusion",
  "sd-",
  "sdxl",
  "grok-2-image",
  "grok-3-imagegen",
  "grok-image",
  "midjourney",
  "imagen",
  "gemini-3-pro-image",
  "-flash-image",
  "kandinsky",
  "playground",
  "ideogram",
  "recraft",
  "kolors",
  "cogview",
  "wanx",
  "jimeng",
  "doubao",
];

// 常见的 LLM 文本模型（明确不支持图像生成）
const LLM_ONLY_MODELS = [
  "gpt-3.5",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4.1",
  "claude",
  "gemini",
  "deepseek",
  "qwen",
  "llama",
  "mistral",
  "grok-2",
  "grok-3",
  "grok-4",
  "meta-llama",
  "moonshot",
  "glm",
  "mixtral",
  "phi",
];

function isImageModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return SUPPORTED_IMAGE_MODELS.some((pattern) => id.includes(pattern));
}

export function isLLMModel(modelId: string): boolean {
  // 图像模型优先：避免「gemini-3-pro-image」「imagen-*」之类含 LLM 关键字但其实是图像模型的命名被误判
  if (isImageModel(modelId)) return false;
  const id = modelId.toLowerCase();
  return LLM_ONLY_MODELS.some((pattern) => id.includes(pattern));
}

export const openaiCompatibleLLM: LLMProvider = {
  async chatCompletion(messages, config, options) {
    const baseUrl = trimUrl(config.baseUrl);
    const model = options.model || config.model;

    const response = await fetchWithError(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        }),
      },
      "LLM API error"
    );

    const data = await response.json();
    return data.choices[0].message.content;
  },
};

/**
 * 把 url（http(s):// 或 data:base64）拉取为 { blob, filename }
 * 用于 /v1/images/edits 的 multipart image[] 字段
 */
async function fetchImageBlob(
  url: string
): Promise<{ blob: Blob; filename: string }> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+)(;base64)?,(.+)$/);
    if (!match) throw new Error("无法解析 data URL 参考图");
    const [, mimeType, base64Marker, payload] = match;
    const buffer = base64Marker
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    const ext = mimeType.split("/")[1] || "png";
    return {
      blob: new Blob([buffer], { type: mimeType }),
      filename: `ref.${ext}`,
    };
  }

  // 把相对 path（如 /uploads/...）补全成绝对 URL
  // 来源：本地存储模式下 DB 存的 referenceImages[] 是 path-only
  // Caddy 的 handle_path /uploads/* 已直接 file_server，loopback 开销可忽略
  let absoluteUrl = url;
  if (!/^https?:\/\//i.test(absoluteUrl)) {
    const base =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://comic.cloudsentryai.com";
    const trimmedBase = base.replace(/\/+$/, "");
    const path = absoluteUrl.startsWith("/") ? absoluteUrl : `/${absoluteUrl}`;
    absoluteUrl = `${trimmedBase}${path}`;
  }

  const resp = await fetch(absoluteUrl);
  if (!resp.ok) {
    throw new Error(`参考图下载失败 (HTTP ${resp.status}): ${absoluteUrl}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const mimeType = resp.headers.get("content-type") || "image/png";
  const ext = mimeType.split("/")[1]?.split(";")[0] || "png";
  return {
    blob: new Blob([arrayBuffer], { type: mimeType }),
    filename: `ref.${ext}`,
  };
}

/**
 * 复用错误识别：HTML / 401 / 404 / non-JSON 的友好错误消息
 * 抛错；如果 response.ok 则不会调用
 */
async function throwOpenAIImageError(
  response: Response,
  baseUrl: string,
  effectiveModel: string,
  endpoint: string
): Promise<never> {
  const errorText = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (
    contentType.includes("text/html") ||
    errorText.trim().toLowerCase().startsWith("<!doctype") ||
    errorText.trim().toLowerCase().startsWith("<html")
  ) {
    const snippet = errorText.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(
      `图像生成失败：API 地址「${baseUrl}」返回了网页而不是 API 响应（HTTP ${response.status}）。\n` +
        `可能原因：\n` +
        `1. API 地址不正确，请检查「设置 > AI 模型配置」中的 Base URL\n` +
        `2. 该 API 服务不支持图像生成接口 ${endpoint}\n` +
        `3. API Key 无效或已过期\n` +
        `4. 上游网关临时不可用（502/525 等）\n\n` +
        `正确的 OpenAI 图像生成 API 地址格式：https://api.openai.com/v1\n` +
        `响应片段：${snippet}`
    );
  }

  if (
    response.status === 404 ||
    errorText.includes("invalid_value") ||
    errorText.includes("not found")
  ) {
    throw new Error(
      `图像生成失败：模型«${effectiveModel}»不可用或接口未实现 (${endpoint})。\n` +
        `请检查：\n` +
        `1. 您的 API 提供商是否支持该模型\n` +
        `2. 模型名称是否正确\n` +
        `3. 如使用中转站，请确认其支持该接口`
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `图像生成失败：API 认证失败（HTTP ${response.status}）。\n` +
        `请检查：\n` +
        `1. API Key 是否正确\n` +
        `2. API Key 是否有图像生成权限\n` +
        `3. 账户余额是否充足`
    );
  }

  throw new Error(
    `Image generation error: ${response.status} ${errorText.slice(0, 300)}`
  );
}

/** 解析图像响应：优先 url，其次 b64_json 包成 data URL */
function parseImageSuccess(data: unknown): string {
  const d = data as { data?: Array<{ url?: string; b64_json?: string }> };
  const item = d.data?.[0];
  if (item?.url) return item.url;
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  throw new Error(
    `图像生成失败：API 响应缺少图像数据（url / b64_json 均为空）。\n` +
      `响应片段：${JSON.stringify(data).slice(0, 200)}`
  );
}

/**
 * 走 OpenAI 兼容的 /v1/images/edits（multipart/form-data）
 * 支持多参考图：用相同字段名 image 重复上传；同时附带 image[] 兼容写法
 * 与 chatgpt2api 文档 §4.2 / OpenAI dall-e-2 edits 兼容
 */
/**
 * 步骤 C：当存在参考图时，给 prompt 末尾追加"人脸严格锚定"指令
 * 提升模型对参考图特征的遵从度（脸型/五官/肤色/发型不变；姿态/表情/光照/服饰可变）
 */
const FACE_ANCHOR_SUFFIX =
  ", maintain exact same facial features as the reference image(s), " +
  "identical face, same person, consistent character identity, " +
  "do not alter face shape, do not change eye color or hair style; " +
  "only the pose, expression, lighting and outfit may vary";

/** 判断错误是否为对端 TCP 断流；这类错误重试通常能成功 */
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes("terminated")) return true;
  const code = (err as { code?: string }).code;
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_SOCKET"
  )
    return true;
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "ECONNRESET" || cause?.code === "ETIMEDOUT") return true;
  if (cause?.message?.includes("ECONNRESET")) return true;
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generateImageWithEdits(
  apiKey: string,
  baseUrl: string,
  effectiveModel: string,
  prompt: string,
  size: string,
  references: string[],
  seed?: number
): Promise<string> {
  const url = `${trimUrl(baseUrl)}/images/edits`;
  // 步骤 C：拼锚定语（仅在参考图存在时）
  const anchoredPrompt =
    references.length > 0 ? `${prompt}${FACE_ANCHOR_SUFFIX}` : prompt;

  // 步骤 B：构造请求 + 重试。FormData/Blob 不可重用，每次必须重新 fetch + 拼装
  const buildRequest = async (): Promise<Response> => {
    const form = new FormData();
    form.append("model", effectiveModel);
    form.append("prompt", anchoredPrompt);
    form.append("n", "1");
    form.append("size", size);
    if (typeof seed === "number") {
      form.append("seed", String(seed));
    }

    let idx = 0;
    for (const ref of references) {
      const { blob, filename } = await fetchImageBlob(ref);
      form.append("image", blob, `${idx}_${filename}`);
      form.append("image[]", blob, `${idx}_${filename}`);
      idx += 1;
    }

    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });
  };

  const RETRY_DELAYS_MS = [1000, 3000];
  let response: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      response = await buildRequest();
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length && isTransientNetworkError(err)) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw err;
    }
  }
  if (!response) throw lastErr ?? new Error("edits 请求未发送");

  if (!response.ok) {
    await throwOpenAIImageError(
      response,
      baseUrl,
      effectiveModel,
      "/images/edits"
    );
  }

  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `图像生成失败：edits 接口返回了非 JSON 数据（Content-Type: ${ct}）。\n` +
        `响应内容：${text.substring(0, 200)}${text.length > 200 ? "..." : ""}`
    );
  }

  const data = await response.json();
  return parseImageSuccess(data);
}

export const openaiCompatibleImage: ImageProvider = {
  async generateImage(options, config) {
    const {
      prompt,
      aspectRatio = "9:16",
      referenceImage,
      referenceImages,
      seed,
    } = options;
    const { apiKey, baseUrl, model } = config;

    if (isLLMModel(model)) {
      throw new Error(
        `模型「${model}」是文本对话模型，不支持图像生成。\n` +
          `请在「设置 > AI 模型配置 > 图像生成」中选择图像生成模型，如：\n` +
          `• dall-e-3（OpenAI）\n` +
          `• gpt-image-1（OpenAI）\n` +
          `• flux-schnell（Replicate/硅基流动）`
      );
    }

    const size = ASPECT_RATIO_TO_SIZE[aspectRatio] || "1024x1024";
    const effectiveModel = model && isImageModel(model) ? model : "dall-e-3";

    // 合并参考图：referenceImages 数组优先；否则用单张 referenceImage
    const refs =
      referenceImages && referenceImages.length > 0
        ? referenceImages
        : referenceImage
          ? [referenceImage]
          : [];

    // 有参考图 → 走 /v1/images/edits（multipart）；chatgpt2api §4.2 / OpenAI dall-e-2 edits 兼容
    if (refs.length > 0) {
      try {
        return await generateImageWithEdits(
          apiKey,
          baseUrl,
          effectiveModel,
          prompt,
          size,
          refs.slice(0, 4), // 与 chatgpt2api §4.2 一致：n/image 上限 4
          seed
        );
      } catch (err) {
        // 若 edits 端点不可用（部分中转不实现），退回普通文生图避免硬失败
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("/images/edits") &&
          (msg.includes("HTTP 404") || msg.includes("404"))
        ) {
          // 落回 generations
        } else {
          throw err;
        }
      }
    }

    const url = `${trimUrl(baseUrl)}/images/generations`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: effectiveModel,
        prompt,
        size,
        n: 1,
        ...(typeof seed === "number" ? { seed } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const contentType = response.headers.get("content-type") || "";

      if (
        contentType.includes("text/html") ||
        errorText.trim().toLowerCase().startsWith("<!doctype") ||
        errorText.trim().toLowerCase().startsWith("<html")
      ) {
        const snippet = errorText.replace(/\s+/g, " ").trim().slice(0, 200);
        throw new Error(
          `图像生成失败：API 地址「${baseUrl}」返回了网页而不是 API 响应（HTTP ${response.status}）。\n` +
            `可能原因：\n` +
            `1. API 地址不正确，请检查「设置 > AI 模型配置」中的 Base URL\n` +
            `2. 该 API 服务不支持图像生成接口 /images/generations\n` +
            `3. API Key 无效或已过期\n` +
            `4. 上游网关临时不可用（502/525 等）\n\n` +
            `正确的 OpenAI 图像生成 API 地址格式：https://api.openai.com/v1\n` +
            `响应片段：${snippet}`
        );
      }

      if (
        response.status === 404 ||
        errorText.includes("invalid_value") ||
        errorText.includes("not found")
      ) {
        throw new Error(
          `图像生成失败：模型«${effectiveModel}»不可用。\n` +
            `请检查：\n` +
            `1. 您的 API 提供商是否支持该模型\n` +
            `2. 模型名称是否正确（如 dall-e-3, gpt-image-1）\n` +
            `3. 如使用中转站，请确认其支持图像生成接口`
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `图像生成失败：API 认证失败（HTTP ${response.status}）。\n` +
            `请检查：\n` +
            `1. API Key 是否正确\n` +
            `2. API Key 是否有图像生成权限\n` +
            `3. 账户余额是否充足`
        );
      }

      throw new Error(
        `Image generation error: ${response.status} ${errorText}`
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(
        `图像生成失败：API 返回了非 JSON 数据（Content-Type: ${contentType}）。\n` +
          `响应内容：${text.substring(0, 200)}${text.length > 200 ? "..." : ""}\n\n` +
          `请确认 API 地址「${baseUrl}」是有效的 OpenAI 兼容图像生成接口。`
      );
    }

    const data = await response.json();
    const item = data.data?.[0];
    if (item?.url) return item.url;
    if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
    throw new Error(
      `图像生成失败：API 响应缺少图像数据（url / b64_json 均为空）。\n` +
        `响应片段：${JSON.stringify(data).slice(0, 200)}`
    );
  },
};
