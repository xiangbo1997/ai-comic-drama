/**
 * Flow2API Image Provider
 *
 * 适配 Google Labs Flow（Imagen / Gemini Image）图片生成网关。
 *
 * 协议特征（与 flow2api-video 同构，公共逻辑见 flow2api-shared.ts）：
 * - 入口统一为 POST /v1/chat/completions + stream:true（SSE）
 * - 最终图片在 finish_reason==='stop' 帧的 content：`![Generated Image](url)`
 *   （2K/4K 缓存失败时 url 可能是 data:image/jpeg;base64 内联兜底）
 * - 图生图：参考图作为 image_url parts 传入（https/data URL）
 *
 * 模型命名规则（朝向编码在模型名里，而非请求参数）：
 *   <base>-(landscape|portrait|square|four-three|three-four)[-2k|-4k]
 * 因此本 provider 会按请求的 aspectRatio 自动改写已选模型的朝向后缀，
 * 让"用户选一个模型 + 项目出 9:16/16:9 分镜"的组合正确工作。
 */

import type { ImageProvider } from "../types";
import { createLogger } from "@/lib/logger";
import {
  buildMultimodalContent,
  requestFlow2apiGeneration,
} from "./flow2api-shared";

const log = createLogger("services:ai:flow2api-image");

/** 模型名中的朝向 token（含分辨率后缀之前的位置） */
const ORIENTATION_TOKENS = [
  "landscape",
  "portrait",
  "square",
  "four-three",
  "three-four",
] as const;

type Orientation = "landscape" | "portrait" | "square";

function aspectToOrientation(aspect?: string): Orientation {
  switch (aspect) {
    case "9:16":
      return "portrait";
    case "1:1":
      return "square";
    case "16:9":
    default:
      return "landscape";
  }
}

/**
 * 按目标朝向改写模型名后缀。
 *
 * 保守策略：
 * - 模型名不含任何已知朝向 token（用户手输的自定义名）→ 原样返回，不猜。
 * - 目标为 square 时仅 gemini 系列改写（imagen 系列没有 square 变体，
 *   强行改写会命中不存在的模型）。
 * - 分辨率后缀（-2k/-4k）保持不动。
 */
export function adaptModelOrientation(
  model: string,
  orientation: Orientation
): string {
  const current = ORIENTATION_TOKENS.find(
    (t) => model.includes(`-${t}-`) || model.endsWith(`-${t}`)
  );
  if (!current || current === orientation) return model;
  if (orientation === "square" && !model.startsWith("gemini")) return model;
  return model.replace(`-${current}`, `-${orientation}`);
}

/** 选择模型：config.model 优先（按朝向改写）；未配置时用 Gemini 3.0 Pro 出图 */
function chooseModel(
  configModel: string | undefined,
  orientation: Orientation
): string {
  const explicit = configModel?.trim();
  if (explicit) {
    return adaptModelOrientation(explicit, orientation);
  }
  return `gemini-3.0-pro-image-${orientation}`;
}

/** 从最终 content 中提取图片 URL（markdown 图片 → 裸 URL 兜底） */
function extractImageUrl(content: string): string | null {
  const md = content.match(/!\[[^\]]*\]\(((?:https?:|data:)[^\s)]+)\)/);
  if (md) return md[1];
  const raw = content.match(/(https?:\/\/[^\s)"'<>]+)/);
  return raw ? raw[1] : null;
}

export const flow2apiImage: ImageProvider = {
  async generateImage(options, config) {
    const {
      prompt,
      referenceImage,
      referenceImages,
      negativePrompt,
      aspectRatio,
      timeoutMs,
    } = options;

    const orientation = aspectToOrientation(aspectRatio);
    const model = chooseModel(config.model, orientation);

    // 合并多图与单图：数组版优先；若无数组但有单张则退化为单元素数组
    const refs =
      referenceImages && referenceImages.length > 0
        ? referenceImages
        : referenceImage
          ? [referenceImage]
          : [];

    // 构造 text 指令：说明参考图作用 + 附加 negative
    // （chat-completion 协议无原生 negative 字段，用自然语言注入）
    const textLines: string[] = [];
    if (refs.length > 0) {
      textLines.push(
        refs.length === 1
          ? "Based on the character shown in the reference image above, generate a new image:"
          : `Based on the characters shown in the ${refs.length} reference images above, keeping their facial features and outfits consistent, generate a new image:`
      );
    }
    textLines.push(prompt);
    if (negativePrompt && negativePrompt.trim()) {
      textLines.push(
        `\n\nAvoid the following elements in the generated image: ${negativePrompt.trim()}`
      );
    }
    const finalText = textLines.join("\n");

    log.info("[flow2api] image start", {
      model,
      orientation,
      refsCount: refs.length,
      promptLen: finalText.length,
    });

    const finalContent = await requestFlow2apiGeneration({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model,
      content: buildMultimodalContent(finalText, refs),
      // 图片通常 10-60s；2K/4K 放大可到数分钟，给 10 分钟上限
      timeoutMs: timeoutMs ?? 600_000,
      label: "图像",
    });

    const imageUrl = extractImageUrl(finalContent);
    if (!imageUrl) {
      throw new Error(
        `flow2api 收到 stop 帧但未能解析图片 URL: ${finalContent.slice(0, 200)}`
      );
    }

    log.info("[flow2api] image done", {
      urlPreview: imageUrl.slice(0, 80),
    });
    return imageUrl;
  },
};
