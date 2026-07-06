/**
 * 系列（多集漫剧）纯函数工具。
 *
 * 新建一集时的两个核心规则收口在这里（API 路由只做编排）：
 * 1. 集数编号：取现有集数最大值 +1，容忍空洞（如手动删了第 3 集）。
 * 2. 生成参数继承：只继承「与具体分镜无关」的全片级参数；凡按 sceneId
 *    键控或与分镜数量强相关的配置（贴图/转场/滤镜/字幕逐镜位置）一律不
 *    带入新集——上一集的 sceneId 在新项目里全是悬垂引用。
 */

import type { GenerationParams } from "@/types/project";

/** 计算下一集编号：已有集数最大值 +1；空系列从 1 开始 */
export function nextEpisodeNumber(
  existing: Array<number | null | undefined>
): number {
  const max = existing.reduce<number>(
    (acc, n) => (typeof n === "number" && n > acc ? n : acc),
    0
  );
  return max + 1;
}

/** 生成集标题：「系列名 第N集」 */
export function buildEpisodeTitle(
  seriesTitle: string,
  episode: number
): string {
  return `${seriesTitle} 第${episode}集`;
}

/**
 * 从上一集的 generationParams 中挑出可跨集继承的全片级参数。
 *
 * 继承：LLM 采样参数、negative prompt、字幕全局样式、水印、BGM
 * 丢弃：subtitlePositions / stickers / sceneEffects（按 sceneId 键控）、
 *       transitions（与分镜数量一一对应）
 */
export function pickCarryOverGenerationParams(
  params: GenerationParams | null | undefined
): GenerationParams {
  if (!params || typeof params !== "object") return {};
  const out: GenerationParams = {};
  if (typeof params.temperature === "number")
    out.temperature = params.temperature;
  if (typeof params.topP === "number") out.topP = params.topP;
  if (typeof params.styleStrength === "number")
    out.styleStrength = params.styleStrength;
  if (typeof params.negativePreset === "string")
    out.negativePreset = params.negativePreset;
  if (typeof params.customNegative === "string")
    out.customNegative = params.customNegative;
  if (params.subtitleStyle && typeof params.subtitleStyle === "object")
    out.subtitleStyle = { ...params.subtitleStyle };
  if (params.watermark && typeof params.watermark === "object")
    out.watermark = { ...params.watermark };
  if (params.backgroundMusic && typeof params.backgroundMusic === "object")
    out.backgroundMusic = { ...params.backgroundMusic };
  return out;
}
