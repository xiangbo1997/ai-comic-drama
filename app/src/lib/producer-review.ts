/**
 * 一键 AI 制片人 · 审阅态归一化（计划 §6 · 3.1）
 *
 * 制片人向导生成的项目会在 Project.generationParams.producerReview 里记录审阅进度：
 * 世界观 / 脚本 / 每个角色 / 每镜分镜的逐项确认状态。编辑器据此显示「草稿待审阅」
 * 横幅，并在全部确认后放行出图。
 *
 * ⚠️ 归一化铁律：Project PATCH 的 generationParams 是白名单（见 api/projects/[id]/route.ts
 * 的 normalizeGenerationParams）——不在此处显式放行，前端怎么存都进不了 DB，审阅态
 * 静默丢失（同 subtitleStyle/backgroundMusic 的「白存」历史坑）。故本模块抽成可单测
 * 的纯函数，由 route 白名单调用。
 */

import type { ProducerReview } from "@/types";

export type { ProducerReview, ProducerReviewConfirmed } from "@/types";

/** id 列表单项上限（防超大 payload）：分镜数上限对齐 500，角色对齐建档上限从宽给 50 */
const MAX_SCENE_IDS = 500;
const MAX_CHARACTER_IDS = 50;
/** 单个 id 截断长度（cuid 约 25 字符，给足冗余） */
const ID_MAX_LEN = 64;

/** 归一化一个 id 字符串数组：过滤非串、截长、去重、限量 */
function normalizeIdList(input: unknown, cap: number): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const id = raw.slice(0, ID_MAX_LEN);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * 白名单归一化 producerReview：形状校验 + 大小钳制。
 *
 * 返回 Prisma 可接受的 plain object；非法/缺省返回 undefined（route 侧 undefined
 * 即不写入该键，保持向后兼容——常规项目永远没有 producerReview）。
 *
 * createdByProducer 只接受严格 true——它是「这是制片人项目」的唯一开关，不允许被
 * 篡改成其它值污染常规项目的 UI 判定。
 */
export function normalizeProducerReview(
  input: unknown
): ProducerReview | undefined {
  if (!input || typeof input !== "object") return undefined;
  const src = input as Record<string, unknown>;

  // 非制片人项目（createdByProducer 非 true）直接丢弃，避免污染常规项目
  if (src.createdByProducer !== true) return undefined;

  const rawConfirmed =
    src.confirmed && typeof src.confirmed === "object"
      ? (src.confirmed as Record<string, unknown>)
      : {};

  return {
    createdByProducer: true,
    confirmed: {
      worldview: rawConfirmed.worldview === true,
      script: rawConfirmed.script === true,
      characters: normalizeIdList(rawConfirmed.characters, MAX_CHARACTER_IDS),
      scenes: normalizeIdList(rawConfirmed.scenes, MAX_SCENE_IDS),
    },
  };
}

/**
 * 审阅是否全部完成：世界观 + 脚本两分区已确认，且每个待确认角色/分镜 id 都在已确认集里。
 *
 * @param review 归一化后的审阅态
 * @param allCharacterIds 项目全部角色 id（需逐个确认）
 * @param allSceneIds 项目全部分镜 id（需逐个确认）
 */
export function isProducerReviewComplete(
  review: ProducerReview | null | undefined,
  allCharacterIds: string[],
  allSceneIds: string[]
): boolean {
  if (!review) return false;
  const { confirmed } = review;
  if (!confirmed.worldview || !confirmed.script) return false;
  const confirmedChars = new Set(confirmed.characters);
  const confirmedScenes = new Set(confirmed.scenes);
  return (
    allCharacterIds.every((id) => confirmedChars.has(id)) &&
    allSceneIds.every((id) => confirmedScenes.has(id))
  );
}

/**
 * 统计审阅进度（已确认项 / 总项）：世界观 + 脚本各算 1 项，角色/分镜逐个算。
 * 供横幅「已确认 x/y」与全部确认判断展示。
 */
export function countProducerReviewProgress(
  review: ProducerReview | null | undefined,
  allCharacterIds: string[],
  allSceneIds: string[]
): { confirmed: number; total: number } {
  const total = 2 + allCharacterIds.length + allSceneIds.length;
  if (!review) return { confirmed: 0, total };
  const { confirmed } = review;
  const confirmedChars = new Set(confirmed.characters);
  const confirmedScenes = new Set(confirmed.scenes);
  let count = 0;
  if (confirmed.worldview) count += 1;
  if (confirmed.script) count += 1;
  count += allCharacterIds.filter((id) => confirmedChars.has(id)).length;
  count += allSceneIds.filter((id) => confirmedScenes.has(id)).length;
  return { confirmed: count, total };
}
