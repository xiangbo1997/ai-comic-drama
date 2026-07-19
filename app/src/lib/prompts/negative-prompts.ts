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
  // 漫剧化负向：抑制呆板无表演的平淡画面（关键帧漫剧感门槛）
  "stiff pose",
  "expressionless face",
  "flat boring composition",
  "centered passport-style framing",
].join(", ");

import { STYLE_PACKS } from "./style-packs";

/**
 * 风格特化负向词 —— 各风格常见的噪声。
 *
 * 单一真源：每个画风包（含新旧共 9 个 style id）的 negative 从 STYLE_PACKS 派生，
 * 再补一个非画风 id 的 `cinematic` 特例（历史保留，供需要影调负向的调用方）。
 */
const STYLE_NEGATIVE: Record<string, string> = {
  ...Object.fromEntries(STYLE_PACKS.map((pack) => [pack.id, pack.negative])),
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

/**
 * 多角色镜头的负向护栏（借鉴 open-storyboard-canvas MultiAnglePanel 的负向约束）。
 *
 * 单人/无角色场景不需要——返回基线 + 风格特化即可；
 * 多人场景额外抑制"人数漂移 / 克隆脸 / 多余人物"等高频崩坏。
 * 与 image-prompt.ts 的 buildConsistencyGuard（正向）配对使用：
 * 正向说"保持什么"，负向说"不要什么"。
 *
 * @param style          风格 key
 * @param characterCount 画面内角色数量
 */
export function getSceneNegativePrompt(
  style: string | null | undefined,
  characterCount: number
): string {
  const base = getNegativePromptPreset(style);
  if (characterCount <= 1) {
    return base;
  }
  const multiPersonNegative = [
    "extra people",
    "duplicated person",
    "cloned face",
    "merged characters",
    "missing person",
  ].join(", ");
  return [base, multiPersonNegative].join(", ");
}
