/**
 * 镜头语言序列体检（纯函数、可单测）
 *
 * 断裂背景：全系统唯一的镜间景别规则是 `prompts/episode-structure.ts` 里的一句
 * 自然语言（「相邻分镜避免同景别同机位」），塞在产出 30-50 镜的长 prompt 中间，
 * LLM 必然遗忘；而 `review-report.ts` 这个现成的确定性体检器检查了镜频、空镜、
 * 对白超时、静止长镜，**唯独 shotType 从不参与任何判据**。
 *
 * 「写进 prompt ≠ 被执行」——本模块把镜头语言规则变成可判定校验。
 *
 * 行业标准（三条）：
 * 1. 相邻两镜景别至少跨一档（级差 ≥1），否则观众感觉「没切」。
 * 2. 同一景别连续不得超过 2 镜（连续 ≥3 即单调）。
 * 3. 每个新地点的首镜应有建立镜（全景/远景），交代空间关系。
 *
 * ⚠️ 档位排序**只对五个真景别**（特写<近景<中景<全景<远景）。SHOT_MAP 里混装的
 * 机位角度键（俯拍/仰拍/过肩/斜角…）语义是「机位」不是「取景范围」，把「俯拍」
 * 当景别参与级差计算是错的——故未知值一律返回 null 并排除出判据。
 */

import {
  parseCompositeShot,
  isCanonicalShotType,
} from "@/lib/shot-type-normalize";

/**
 * 景别档位序：由「取景范围」从紧到松排列，索引即档位。
 * 相邻镜的档位差即「级差」，跨档越大切换感越强。
 */
export const SHOT_SCALE_ORDER = [
  "特写",
  "近景",
  "中景",
  "全景",
  "远景",
] as const;

/** 连续同景别达到此镜数即判定单调（行业标准：同景别不超过 2 连） */
const SAME_SCALE_RUN_THRESHOLD = 3;

/** 相邻级差为 0 的镜对占比超过此值即告警 */
const FLAT_TRANSITION_RATIO_WARN = 0.3;

/** 建立镜合法景别（新地点首镜应交代空间） */
const ESTABLISHING_SCALES = new Set<string>(["全景", "远景"]);

/**
 * 景别 → 档位索引（0=特写 … 4=远景）。
 *
 * 先过 B1 的归一（复合值「大特写·急推」、别名「大全景」都要能识别），
 * 归一后仍非标准五景别（机位角度键、乱输入、空值）一律返回 null，
 * 由调用方排除出级差判据——不猜、不当作某一档参与排序。
 */
export function shotScaleIndex(shot?: string | null): number | null {
  const normalized = parseCompositeShot(shot).shotType;
  if (!isCanonicalShotType(normalized)) return null;
  return SHOT_SCALE_ORDER.indexOf(normalized);
}

/** 参与镜头语言体检的单镜最小形状 */
export interface ShotSequenceScene {
  /** 分镜序号（0 起，与 DB scene.order 同源；报告展示时 +1） */
  order: number;
  shotType?: string | null;
  /** 地点标签：新地点首镜的建立镜判据用 */
  locationKey?: string | null;
}

/** 一段连续同景别 */
export interface SameScaleRun {
  /** 起始分镜 order */
  startOrder: number;
  /** 连续镜数 */
  length: number;
  /** 该段的景别（标准五档之一） */
  scale: string;
}

/** 一处级差为 0 的相邻镜对（记后一镜的 order） */
export interface FlatTransition {
  order: number;
}

/** 一处缺失建立镜的地点 */
export interface MissingEstablishing {
  locationKey: string;
  /** 该地点首镜的 order */
  firstOrder: number;
}

/** analyzeShotSequence 的产出 */
export interface ShotSequenceAnalysis {
  /** 连续同景别 ≥3 镜的片段 */
  sameScaleRuns: SameScaleRun[];
  /** 相邻级差为 0 的镜对 */
  flatTransitions: FlatTransition[];
  /** 特写+近景占比（0-1）；无可识别景别时为 0 */
  closeUpRatio: number;
  /** 首镜非全景/远景的地点 */
  missingEstablishing: MissingEstablishing[];
  /** 参与判据的可识别景别镜数（分母，供调用方判断样本是否足够） */
  recognizedCount: number;
  /** 参与级差判据的相邻镜对总数（分母） */
  comparablePairs: number;
}

/**
 * 分析全片镜头语言序列（纯函数，不改入参）。
 *
 * 所有判据只对「可识别为标准五景别」的镜生效：未标景别、机位角度键、乱输入
 * 一律跳过——它们会**打断**连续同景别的计数（未知镜插在中间不算连坐），
 * 也不参与级差比较（相邻对中任一为未知即跳过该对）。
 */
export function analyzeShotSequence(
  scenes: ShotSequenceScene[]
): ShotSequenceAnalysis {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);

  const indexed = ordered.map((s) => ({
    scene: s,
    scaleIndex: shotScaleIndex(s.shotType),
  }));

  const recognized = indexed.filter((x) => x.scaleIndex !== null);

  // ① 连续同景别 ≥3（未知景别镜打断连续段）
  const sameScaleRuns: SameScaleRun[] = [];
  let runStart = 0;
  let runLength = 0;
  let runScale: number | null = null;

  const flushRun = () => {
    if (runScale !== null && runLength >= SAME_SCALE_RUN_THRESHOLD) {
      sameScaleRuns.push({
        startOrder: runStart,
        length: runLength,
        scale: SHOT_SCALE_ORDER[runScale],
      });
    }
  };

  for (const { scene, scaleIndex } of indexed) {
    if (scaleIndex === null) {
      // 未知景别：结算当前段并清零（不把未知镜并进任何一段）
      flushRun();
      runScale = null;
      runLength = 0;
      continue;
    }
    if (scaleIndex === runScale) {
      runLength += 1;
    } else {
      flushRun();
      runScale = scaleIndex;
      runStart = scene.order;
      runLength = 1;
    }
  }
  flushRun();

  // ② 相邻级差为 0（两镜都可识别才比较）
  const flatTransitions: FlatTransition[] = [];
  let comparablePairs = 0;
  for (let i = 1; i < indexed.length; i++) {
    const prev = indexed[i - 1].scaleIndex;
    const curr = indexed[i].scaleIndex;
    if (prev === null || curr === null) continue;
    comparablePairs += 1;
    if (prev === curr) {
      flatTransitions.push({ order: indexed[i].scene.order });
    }
  }

  // ③ 特写 + 近景占比（竖屏漫剧应以近景/特写为主，过低说明景别偏松散）
  const closeUpCount = recognized.filter(
    (x) => x.scaleIndex === 0 || x.scaleIndex === 1
  ).length;
  const closeUpRatio =
    recognized.length > 0 ? closeUpCount / recognized.length : 0;

  // ④ 每个地点首镜是否为建立镜（全景/远景）
  const missingEstablishing: MissingEstablishing[] = [];
  const seenLocations = new Set<string>();
  for (const { scene, scaleIndex } of indexed) {
    const key = scene.locationKey?.trim();
    if (!key || seenLocations.has(key)) continue;
    seenLocations.add(key);
    // 首镜景别不可识别时不下结论（缺数据 ≠ 缺建立镜）
    if (scaleIndex === null) continue;
    if (!ESTABLISHING_SCALES.has(SHOT_SCALE_ORDER[scaleIndex])) {
      missingEstablishing.push({ locationKey: key, firstOrder: scene.order });
    }
  }

  return {
    sameScaleRuns,
    flatTransitions,
    closeUpRatio,
    missingEstablishing,
    recognizedCount: recognized.length,
    comparablePairs,
  };
}

/**
 * 给「连续同景别」段推荐一个替换景别（供 suggestion 文案给出可执行建议）。
 *
 * 策略：取与该段景别跨度最大的一档——特写/近景段建议改远景侧，
 * 全景/远景段建议改特写侧，中景段建议改特写（竖屏漫剧以近景/特写为主）。
 */
export function suggestContrastScale(scale: string): string {
  const idx = SHOT_SCALE_ORDER.indexOf(
    scale as (typeof SHOT_SCALE_ORDER)[number]
  );
  if (idx < 0) return "特写";
  // 靠近特写侧（0,1）→ 建议全景；靠近远景侧（3,4）→ 建议特写；中景 → 特写
  if (idx <= 1) return "全景";
  if (idx >= 3) return "特写";
  return "特写";
}

export {
  SAME_SCALE_RUN_THRESHOLD,
  FLAT_TRANSITION_RATIO_WARN,
  ESTABLISHING_SCALES,
};
