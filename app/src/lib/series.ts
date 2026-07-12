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
import { isBibleEmpty, type SeriesStoryBible } from "@/types/series-bible";

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

// ============ 故事圣经 reader（跨集永久记忆的单一渲染源） ============

/** digest 预算：脚本阶段（解析/短剧生成）看得多，场景阶段（图/视）看得少 */
const DIGEST_SCRIPT_MAX_CHARS = 2000;
const DIGEST_SCENE_MAX_CHARS = 600;
/** 脚本阶段最多列近 N 集分集功能表 */
const RECENT_EPISODES_IN_DIGEST = 3;
/** 场景阶段角色状态最多列 N 个（预算紧，只保留最相关的） */
const SCENE_MAX_CHARACTERS = 6;

/** scene 阶段情绪→色调映射最多列 N 条（预算紧，只保留头部） */
const SCENE_MAX_MOOD_PALETTES = 3;

/** 按 episodeNumber 升序排序（拷贝，不改原数组） */
function sortedEpisodes(bible: SeriesStoryBible) {
  return [...bible.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/**
 * 把色彩指定（color script）渲染成一段注入文本。空色板返回 null。
 * - stage 'scene'（出图/视频）：精简——主色板 + 整体色调 + 头部几条情绪色调，
 *   前缀强调「全片统一、出图必须遵守」，让模型据此锁色调。
 * - stage 'script'（解析/短剧）：极简——只给整体色调 + 主色板，脚本阶段无需铺满。
 */
function renderColorScript(
  bible: SeriesStoryBible,
  stage: "script" | "scene"
): string | null {
  const cs = bible.colorScript;
  if (!cs) return null;

  const keyColors = (cs.keyColors ?? []).filter((c) => c.trim().length > 0);
  const tone = cs.overallTone?.trim();
  const moods = (cs.moodPalettes ?? []).filter(
    (m) => m.mood.trim().length > 0 && m.palette.trim().length > 0
  );
  if (keyColors.length === 0 && !tone && moods.length === 0) return null;

  const bits: string[] = [];
  if (keyColors.length > 0) bits.push(`主色板：${keyColors.join("、")}`);
  if (tone) bits.push(`整体色调：${tone}`);

  if (stage === "scene") {
    if (moods.length > 0) {
      const moodBits = moods
        .slice(0, SCENE_MAX_MOOD_PALETTES)
        .map((m) => `${m.mood}→${m.palette}`);
      bits.push(`情绪色调：${moodBits.join("；")}`);
    }
    if (bits.length === 0) return null;
    return `【色彩指定（全片统一，出图必须遵守此主色板，单镜色彩只在其内局部偏移）】${bits.join("；")}`;
  }

  // stage === "script"：极简，脚本阶段只提示整体色调基调
  if (bits.length === 0) return null;
  return `【色彩基调（全片统一）】${bits.join("；")}`;
}

/**
 * 抽取「精简色板串」（无 digest 前缀），供出图 prompt 前置与 Observer 色调门禁复用。
 *
 * 与 renderColorScript 的区别：renderColorScript 产出带说明前缀的注入段（给 digest），
 * 这里只要裸色板事实——「主色板：…；整体色调：…」——让 buildEnhancedPrompt 的
 * seriesPalette / Observer 的 expectedPalette 拿去当基准。空色板返回 undefined。
 */
export function extractSeriesPalette(
  bible: SeriesStoryBible
): string | undefined {
  const cs = bible.colorScript;
  if (!cs) return undefined;
  const keyColors = (cs.keyColors ?? []).filter((c) => c.trim().length > 0);
  const tone = cs.overallTone?.trim();
  const bits: string[] = [];
  if (keyColors.length > 0) bits.push(`主色板：${keyColors.join("、")}`);
  if (tone) bits.push(`整体色调：${tone}`);
  return bits.length > 0 ? bits.join("；") : undefined;
}

/** 上一集（< currentEpisode 的最大集）；无 currentEpisode 取最后一集 */
function lastEpisodeBefore(bible: SeriesStoryBible, currentEpisode?: number) {
  const eps = sortedEpisodes(bible);
  if (eps.length === 0) return null;
  if (currentEpisode == null) return eps[eps.length - 1];
  const before = eps.filter((e) => e.episodeNumber < currentEpisode);
  return before.length > 0 ? before[before.length - 1] : null;
}

/** 截断到预算上限（超限加省略号，保留可读性） */
function clampDigest(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * 把故事圣经渲染成预算化的记忆摘要（digest），供管线注入。空圣经返回 null。
 *
 * - stage 'script'（≤2000 字）：主题锁 + 色彩基调（极简）+ 世界观精要 + 未解决
 *   伏笔 + 近 3 集 logline/结尾钩 + 上一集结尾钩 + 近 3 集钩子类型 + 角色当前
 *   状态 + 既定场景/道具名单。给「文本→分镜解析」「世界观→短剧脚本」用。
 * - stage 'scene'（≤600 字）：色彩指定（全片统一主色板，最前）+ 角色当前状态 +
 *   上一集结尾钩 + 关键既定场景/道具。给「视频导演」「图像分析」用，只需连续性
 *   锚点，不需要全局叙事。
 */
export function buildSeriesMemoryDigest(
  bible: SeriesStoryBible,
  opts: { stage: "script" | "scene"; currentEpisode?: number }
): string | null {
  if (isBibleEmpty(bible)) return null;

  const { stage, currentEpisode } = opts;
  const lastEp = lastEpisodeBefore(bible, currentEpisode);
  const openThreads = bible.threads.filter((t) => t.status === "open");

  if (stage === "scene") {
    const parts: string[] = [];

    // 色彩指定优先注入（出图/视频阶段最需要统一色调，放最前让模型重视）
    const colorScene = renderColorScript(bible, "scene");
    if (colorScene) parts.push(colorScene);

    const chars = bible.characters.slice(0, SCENE_MAX_CHARACTERS);
    if (chars.length > 0) {
      const lines = chars.map((c) => {
        const extra = c.forbiddenChanges
          ? `（不可改：${c.forbiddenChanges}）`
          : "";
        return `- ${c.name}：${c.state}${extra}`;
      });
      parts.push(`角色当前状态：\n${lines.join("\n")}`);
    }

    if (lastEp?.endingHook) {
      parts.push(`上一集结尾钩：${lastEp.endingHook}`);
    }

    const locNames = bible.locations.map((l) => l.name).filter(Boolean);
    const propNames = bible.props.map((p) => p.name).filter(Boolean);
    if (locNames.length > 0 || propNames.length > 0) {
      const setBits = [
        locNames.length > 0 ? `场景：${locNames.join("、")}` : "",
        propNames.length > 0 ? `道具：${propNames.join("、")}` : "",
      ].filter(Boolean);
      parts.push(`既定设定（沿用，勿改）：${setBits.join("；")}`);
    }

    if (parts.length === 0) return null;
    return clampDigest(parts.join("\n"), DIGEST_SCENE_MAX_CHARS);
  }

  // stage === "script"
  const parts: string[] = [];

  if (bible.theme) parts.push(`主题锁（全集服务它）：${bible.theme}`);

  // 色彩基调极简注入（脚本阶段只需知道全片统一色调，不铺满）
  const colorScript = renderColorScript(bible, "script");
  if (colorScript) parts.push(colorScript);

  if (bible.worldSetting) {
    const ws = bible.worldSetting;
    const wsBits = [
      ws.era ? `纪元：${ws.era}` : "",
      ws.rules ? `规则：${ws.rules}` : "",
      ws.lore ? `设定：${ws.lore}` : "",
      ws.visualGuideline ? `视觉基调：${ws.visualGuideline}` : "",
    ].filter(Boolean);
    if (wsBits.length > 0) parts.push(`世界观：\n${wsBits.join("\n")}`);
  }

  if (openThreads.length > 0) {
    const lines = openThreads.map((t) => {
      const note = t.note ? `（${t.note}）` : "";
      return `- 第${t.plantedEpisode}集埋下：${t.title}${note}`;
    });
    parts.push(`未解决伏笔（本集可推进/回收，勿遗忘）：\n${lines.join("\n")}`);
  }

  const recent = sortedEpisodes(bible).slice(-RECENT_EPISODES_IN_DIGEST);
  if (recent.length > 0) {
    const lines = recent.map((e) => {
      const hook = e.endingHook ? `｜结尾钩：${e.endingHook}` : "";
      return `- 第${e.episodeNumber}集《${e.title}》：${e.logline}${hook}`;
    });
    parts.push(`近${recent.length}集回顾：\n${lines.join("\n")}`);

    const hookTypes = recent
      .map((e) => e.hookType)
      .filter((h): h is NonNullable<typeof h> => Boolean(h));
    if (hookTypes.length > 0) {
      parts.push(`近${recent.length}集钩子类型：${hookTypes.join("、")}`);
    }
  }

  if (lastEp?.endingHook) {
    parts.push(`上一集结尾钩（本集开场承接）：${lastEp.endingHook}`);
  }

  if (bible.characters.length > 0) {
    const lines = bible.characters.map((c) => {
      const extra = c.forbiddenChanges
        ? `（不可改：${c.forbiddenChanges}）`
        : "";
      return `- ${c.name}：${c.state}${extra}`;
    });
    parts.push(`角色当前状态：\n${lines.join("\n")}`);
  }

  const locNames = bible.locations.map((l) => l.name).filter(Boolean);
  const propNames = bible.props.map((p) => p.name).filter(Boolean);
  if (locNames.length > 0 || propNames.length > 0) {
    const setBits = [
      locNames.length > 0 ? `既定场景：${locNames.join("、")}` : "",
      propNames.length > 0 ? `既定道具：${propNames.join("、")}` : "",
    ].filter(Boolean);
    parts.push(setBits.join("；"));
  }

  if (parts.length === 0) return null;
  return clampDigest(parts.join("\n\n"), DIGEST_SCRIPT_MAX_CHARS);
}
