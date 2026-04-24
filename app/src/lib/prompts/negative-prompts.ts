/**
 * Negative Prompt 预设库
 *
 * 按风格维度组织：通用基线 + 风格特化。服务端/客户端生成图像时拼接到请求，
 * 用于抑制低质量、畸形、版权元素、水印、多余文字等常见问题。
 *
 * 设计原则：
 * - 中转站/Fal/Replicate/OpenAI 对 negativePrompt 支持不一：能用则用，不支持则
 *   写入 messages 内容里由模型理解。提示词层不做适配——留给 provider 适配层。
 * - 避免过长：每个预设 < 200 字符，避免压缩主体 prompt 的权重。
 */

/** 通用基线：任何风格都应规避的低质量产物 */
const NEGATIVE_BASELINE = [
  "lowres",
  "worst quality",
  "low quality",
  "jpeg artifacts",
  "blurry",
  "out of focus",
  "watermark",
  "signature",
  "text",
  "extra digits",
  "fewer digits",
  "bad anatomy",
  "bad hands",
  "extra fingers",
  "fused fingers",
  "mutated hands",
  "deformed",
  "disfigured",
  "cropped",
  "duplicate",
].join(", ");

/** 风格特化 —— 各风格常见的噪声 */
const STYLE_NEGATIVE: Record<string, string> = {
  anime: "3d render, photorealistic, real photo, realistic skin texture",
  realistic: "cartoon, anime, painting, illustration, sketch, cel shading",
  comic: "photo, 3d, realistic skin texture, soft shading",
  watercolor: "digital art, harsh lines, 3d render",
  oil: "digital art, flat shading, anime",
  sketch: "color, 3d, shaded rendering, painted",
  "3d": "flat illustration, 2d anime, cel shaded",
  cyberpunk: "medieval, fantasy village, rustic",
  fantasy: "modern technology, cars, skyscrapers",
  cinematic: "cartoon, anime, flat lighting, unbalanced composition",
};

export type NegativePromptPreset = keyof typeof STYLE_NEGATIVE | "default";

/**
 * 取风格对应的 negative prompt。
 * - 传入未知风格 → 回落到 `anime`（与 `getStylePrefix` 保持一致）。
 * - 返回的字符串已经是 baseline + 风格特化的拼接结果。
 */
export function getNegativePromptPreset(style?: string | null): string {
  const key = style && STYLE_NEGATIVE[style] ? style : "anime";
  return [NEGATIVE_BASELINE, STYLE_NEGATIVE[key]].filter(Boolean).join(", ");
}

/**
 * 仅取基线（不带风格特化），供需要自己组合的场景使用。
 */
export function getNegativeBaseline(): string {
  return NEGATIVE_BASELINE;
}
