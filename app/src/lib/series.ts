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

/** 上一集剧情上下文（route 从 ShortDramaScript 或 Scene 兜底组装） */
export interface PreviousEpisodeContext {
  episodeNumber: number | null;
  /** 上一集片名/项目标题 */
  title: string | null;
  /** 一句话梗概（无短剧脚本时可为 null） */
  logline: string | null;
  /** 结尾场景（取最后 1-2 个，承接钩子的来源） */
  endingScenes: Array<{
    description: string;
    dialogue?: string | null;
    narration?: string | null;
  }>;
}

/** 单场景描述截断上限：前情提要只需要钩子，不需要完整分镜 */
const RECAP_SCENE_MAX_CHARS = 300;

/**
 * 把上一集剧情压缩成「前情提要」文本，注入下一集脚本生成 prompt
 * （见 prompts/agent-prompts/drama-script.ts）。无可用内容返回 null。
 */
export function buildPreviousEpisodeRecap(
  ctx: PreviousEpisodeContext
): string | null {
  const lines: string[] = [];
  const epLabel =
    ctx.episodeNumber != null ? `第${ctx.episodeNumber}集` : "上一集";
  if (ctx.title) lines.push(`${epLabel}《${ctx.title}》`);
  if (ctx.logline) lines.push(`梗概：${ctx.logline}`);

  const endings = ctx.endingScenes
    .filter((s) => s.description && s.description.trim().length > 0)
    .slice(-2);
  if (endings.length > 0) {
    lines.push("结尾场景：");
    for (const s of endings) {
      const parts = [s.description.trim().slice(0, RECAP_SCENE_MAX_CHARS)];
      if (s.dialogue?.trim()) parts.push(`对白「${s.dialogue.trim()}」`);
      if (s.narration?.trim()) parts.push(`旁白「${s.narration.trim()}」`);
      lines.push(`- ${parts.join("；")}`);
    }
  }

  // 只有集数标签没有实质剧情信息时视为不可用
  return lines.length > (ctx.title ? 1 : 0) ? lines.join("\n") : null;
}
