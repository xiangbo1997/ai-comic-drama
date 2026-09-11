/**
 * BGM 情绪分段调度器（纯函数）。
 *
 * 解决「一首舒缓钢琴从头铺到尾」——打斗是它、落泪是它、反转还是它。
 * 行业做法是 BGM 按情绪段落切换，一集 3-6 段是常态，切换点落在情绪转折镜
 * 或高潮镜（isClimax）处，段间必须交叉淡化（硬切=业余）。
 *
 * 本模块只负责「分段规划」这一层纯计算：把逐分镜的 emotion / isClimax 归并成
 * 若干连续时间段，每段带一个 BGM 分类 id。选曲（分类 → 具体曲目）与滤镜链
 * 构建分别由调用方与 video-synthesis/filters/audio.ts 负责，职责不混。
 *
 * 情绪 → 分类映射复用 lib/emotion-bgm.ts 的单一真源（不另写一套），
 * 保证「自动选曲」与「分段切换」两条路径对同一情绪给出同一分类。
 */

import { emotionToBgmCategory, type BgmCategoryId } from "./emotion-bgm";

/**
 * 一段 BGM 的时间窗与分类。
 * startSec / endSec 是全片绝对秒（与 buildSceneStarts 同一时间轴）。
 */
export interface BgmSegment {
  /** BGM 分类 id（BGM_CATEGORIES 的 id，供调用方在该分类里挑曲） */
  category: BgmCategoryId;
  /** 段起始（全片绝对秒） */
  startSec: number;
  /** 段结束（全片绝对秒） */
  endSec: number;
}

/** 分段的最短时长（秒）。短于此的段与相邻段合并，防「配乐碎片化」。 */
export const MIN_BGM_SEGMENT_SEC = 8;

/** 段间交叉淡化时长（秒）。行业区间 1.5-2.5s，取中值 2s。 */
export const BGM_CROSSFADE_SEC = 2;

/** 分段规划的输入分镜（只取影响配乐的两个字段） */
export interface BgmSegmentScene {
  /** 分镜情绪标签（解析层产出；空/未知走 emotionToBgmCategory 的 calm 回落） */
  emotion?: string | null;
  /** 高潮镜标记——强制在此处开新段（情绪转折点，见下方说明） */
  isClimax?: boolean | null;
}

/**
 * 规划全片 BGM 分段。
 *
 * 算法（三步，顺序不可换）：
 *   1. **逐镜映射 + 连续合并**：把每个分镜的 emotion 映射成 BGM 分类，
 *      相邻同分类的镜合并成一段。`isClimax` 的分镜**强制断段**——高潮镜是
 *      情绪转折点，即便它与前一镜情绪同类（例如连续两个 angry），配乐也该
 *      在此处换一首推起来，这正是「有配乐设计」的听感来源。
 *   2. **短段合并**：任何短于 MIN_BGM_SEGMENT_SEC 的段与相邻段合并，
 *      合并后采用「时长更长的那一段」的情绪（长段主导听感）。反复迭代直到
 *      不再有短段或只剩一段——单次扫描不够，合并后可能又产生新的短段。
 *   3. **退化保护**：空输入 / 单段 → 返回单元素数组（与原「全片一首」行为等价）。
 *
 * @param scenes       逐分镜的情绪与高潮标记（与 sceneStarts/effDurations index 对齐）
 * @param sceneStarts  各分镜在全片时间轴的起始秒（buildSceneStarts 产出）
 * @param effDurations 各分镜实测有效时长（秒）
 * @returns 按时间升序、首尾相接、无空隙的分段数组；输入为空时返回空数组
 */
export function planBgmSegments(
  scenes: BgmSegmentScene[],
  sceneStarts: number[],
  effDurations: number[]
): BgmSegment[] {
  const n = Math.min(scenes.length, sceneStarts.length, effDurations.length);
  if (n <= 0) return [];

  // ── 1. 逐镜映射 + 连续同分类合并（isClimax 强制断段）────────────────
  const raw: BgmSegment[] = [];
  for (let i = 0; i < n; i += 1) {
    const category = emotionToBgmCategory(scenes[i].emotion ?? "");
    const start = sceneStarts[i];
    const end = start + Math.max(0, effDurations[i]);
    const prev = raw[raw.length - 1];
    // 高潮镜强制开新段；否则同分类则并入前一段
    const forceBreak = scenes[i].isClimax === true;
    if (prev && prev.category === category && !forceBreak) {
      prev.endSec = end;
    } else {
      raw.push({ category, startSec: start, endSec: end });
    }
  }

  return mergeShortSegments(raw);
}

/**
 * 把短于 MIN_BGM_SEGMENT_SEC 的段并入相邻段（迭代至收敛）。
 *
 * 合并规则：短段与「左右两邻中时长更长者」合并，合并后整段采用该长邻的分类
 * ——听感由长段主导，短段只是被吸收的过渡。只有一个邻居时（首/末段）并入它。
 * 每轮只处理「当前最短的那个短段」，处理完重新扫描，避免一次批量合并产生
 * 顺序依赖导致结果不可复现（单测需要确定性）。
 */
function mergeShortSegments(input: BgmSegment[]): BgmSegment[] {
  const segs = input.map((s) => ({ ...s }));

  // 每轮找出最短的短段并合并；最多迭代 segs.length 轮（每轮至少消一段）
  for (let guard = 0; guard < input.length && segs.length > 1; guard += 1) {
    let shortIdx = -1;
    let shortDur = Infinity;
    for (let i = 0; i < segs.length; i += 1) {
      const dur = segs[i].endSec - segs[i].startSec;
      if (dur < MIN_BGM_SEGMENT_SEC && dur < shortDur) {
        shortDur = dur;
        shortIdx = i;
      }
    }
    if (shortIdx < 0) break; // 无短段，收敛

    const left = shortIdx > 0 ? segs[shortIdx - 1] : null;
    const right = shortIdx < segs.length - 1 ? segs[shortIdx + 1] : null;
    const leftDur = left ? left.endSec - left.startSec : -1;
    const rightDur = right ? right.endSec - right.startSec : -1;

    // 并入更长的那一侧（平局偏左，保证确定性）
    if (left && leftDur >= rightDur) {
      left.endSec = segs[shortIdx].endSec;
      segs.splice(shortIdx, 1);
    } else if (right) {
      right.startSec = segs[shortIdx].startSec;
      segs.splice(shortIdx, 1);
    } else {
      break; // 无邻居可并（理论不可达，segs.length>1 时必有邻居）
    }
  }

  return segs;
}
