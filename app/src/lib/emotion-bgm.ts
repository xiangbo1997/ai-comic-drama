/**
 * 剧情主情绪 → BGM 分类映射（纯函数）。
 *
 * 用途：配乐弹窗「按剧情主情绪自动选曲」——统计全片分镜 Scene.emotion 的多数派，
 * 映射到 bgm-library 的分类 id，据此在该分类里挑一首内置曲。让用户一键得到与
 * 剧情情绪匹配的背景音乐，无需逐一试听。
 *
 * emotion 取值来自解析层（neutral/happy/sad/angry/surprised/fear），
 * 目标分类是 BGM_CATEGORIES 的 id（calm/tension/upbeat/suspense/epic/sad/romance）。
 */

import type { SfxCategory } from "./sfx-library";

// 引用 BgmCategory 的 id 类型（保持与 bgm-library 单一真源，避免硬编码字符串漂移）。
// 这里只用到分类 id 字符串，故用宽松类型别名而非导入整表（lib 内互引最小化）。
export type BgmCategoryId =
  | "calm"
  | "tension"
  | "upbeat"
  | "suspense"
  | "epic"
  | "sad"
  | "romance";

/** 解析层情感标签（与 Scene.emotion 对齐；未知值走默认） */
export type SceneEmotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "fear"
  | string;

/**
 * 单个情感 → BGM 分类的映射表。
 * - neutral   → calm（中性铺底）
 * - happy     → upbeat（欢快）
 * - sad       → sad（悲伤）
 * - angry     → tension（紧张对峙）
 * - surprised → suspense（悬念 / 意外）
 * - fear      → suspense（惊悚 / 恐惧）
 * 未列出的情感回落 calm。
 */
const EMOTION_TO_BGM: Record<string, BgmCategoryId> = {
  neutral: "calm",
  happy: "upbeat",
  sad: "sad",
  angry: "tension",
  surprised: "suspense",
  fear: "suspense",
};

/** 默认 BGM 分类（无分镜 / 无有效情感时） */
export const DEFAULT_BGM_CATEGORY: BgmCategoryId = "calm";

/**
 * 把单个情感映射到 BGM 分类（未知情感回落 calm）。
 */
export function emotionToBgmCategory(emotion: SceneEmotion): BgmCategoryId {
  return EMOTION_TO_BGM[emotion] ?? DEFAULT_BGM_CATEGORY;
}

/**
 * 统计一组分镜情感的「多数派 BGM 分类」。
 *
 * 规则：
 *   1. 逐分镜把 emotion 映射为 BGM 分类，累加计票；
 *   2. 取票数最高的分类；平票时取「先达到该票数」的分类（遍历顺序稳定，
 *      结果可复现，便于单测）；
 *   3. 空输入 / 全部无有效情感 → 返回默认分类 calm。
 *
 * @param emotions 分镜情感数组（可含 null/undefined/空串，跳过）
 * @returns 多数派 BGM 分类 id
 */
export function majorityBgmCategory(
  emotions: Array<SceneEmotion | null | undefined>
): BgmCategoryId {
  const tally = new Map<BgmCategoryId, number>();
  let best: BgmCategoryId | null = null;
  let bestCount = 0;

  for (const raw of emotions) {
    if (!raw || typeof raw !== "string" || raw.trim() === "") continue;
    const category = emotionToBgmCategory(raw);
    const count = (tally.get(category) ?? 0) + 1;
    tally.set(category, count);
    // 严格大于才更新 → 平票保留先到者（遍历顺序稳定）
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }

  return best ?? DEFAULT_BGM_CATEGORY;
}

/**
 * 情感 → 建议音效分类（供解析层 / 前端「一键填充」的补充启发，非强绑定）。
 * 仅作提示：安静/中性情绪不建议音效（返回 null）。
 */
export function emotionToSuggestedSfxCategory(
  emotion: SceneEmotion
): SfxCategory | null {
  switch (emotion) {
    case "angry":
      return "hit";
    case "surprised":
      return "whoosh";
    case "fear":
      return "heartbeat";
    default:
      return null;
  }
}
