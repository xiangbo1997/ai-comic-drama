/**
 * 一键 AI 制片人 · 角色名抽取（计划 §6 · 3.1）
 *
 * 从生成的短剧脚本（DramaScriptArtifact）里抽出「需要建档的角色名」，供制片人
 * 向导批量创建 Character 记录（再逐个跑外貌预填）。刻意不调 CharacterBibleAgent
 * （那是自动 workflow 内部件），只做确定性文本抽取——一次 LLM 都不花。
 *
 * 抽取来源（去重后按出现顺序）：
 * 1. 主角（doc.protagonist 里的人名，永远排第一）；
 * 2. 各场景对白行「名字：台词」里冒号前的说话人。
 *
 * 过滤规则：
 * - 忽略旁白 / 独白 / 画外音等非角色标记（NARRATION_MARKERS）；
 * - 名字需 2-8 字、纯中文（避免把英文缩写 / 标点 / 长句误当角色）；
 * - 上限 6 个（成本护栏：向导对每个角色最多跑 1 次外貌预填 LLM）。
 */

import type { DramaScriptArtifact } from "@/types/drama";

/** 抽取上限：与向导「每角色 1 次外貌预填」的成本护栏一致 */
export const MAX_PRODUCER_CHARACTERS = 6;

/**
 * 非角色说话人标记：这些冒号前缀是叙事标注而非人物，需剔除。
 * 命中判据为「名字包含任一标记子串」，覆盖「旁白」「画外音(OS)」「独白」等变体。
 */
const NARRATION_MARKERS = [
  "旁白",
  "画外音",
  "独白",
  "内心",
  "字幕",
  "os",
  "v.o",
  "vo",
  "voiceover",
  "narration",
  "sfx",
  "bgm",
];

/** 全角/半角冒号：对白说话人分隔符 */
const COLON_SPLIT = /[：:]/;

/** 合法角色名：2-8 个中文字符（含·，兼容音译名如「阿米娅·」不含点则更严） */
const VALID_NAME = /^[一-龥]{2,8}$/;

/** 判断一个候选说话人是否为非角色叙事标记 */
function isNarrationMarker(name: string): boolean {
  const lower = name.toLowerCase();
  return NARRATION_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * 从主角描述里抽第一个人名。
 *
 * doc.protagonist 常是「林烬，被家族背叛的天才炼丹师」这类「人名 + 身份」句，
 * 取第一个逗号/句读前的片段，再校验是否为合法人名；抽不到返回 null。
 */
function extractProtagonistName(
  protagonist: string | null | undefined
): string | null {
  const trimmed = protagonist?.trim();
  if (!trimmed) return null;
  // 取首个自然停顿前的片段作为候选人名
  const head = trimmed.split(/[，,。.、\s（(]/)[0]?.trim() ?? "";
  return VALID_NAME.test(head) && !isNarrationMarker(head) ? head : null;
}

/**
 * 从一段对白文本里抽所有「名字：台词」的说话人。
 * 对白可能多行，逐行取冒号前片段做校验。
 */
function extractSpeakersFromDialogue(
  dialogue: string | null | undefined
): string[] {
  if (!dialogue?.trim()) return [];
  const speakers: string[] = [];
  for (const rawLine of dialogue.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !COLON_SPLIT.test(line)) continue;
    const speaker = line.split(COLON_SPLIT)[0]?.trim() ?? "";
    if (VALID_NAME.test(speaker) && !isNarrationMarker(speaker)) {
      speakers.push(speaker);
    }
  }
  return speakers;
}

/**
 * 从短剧脚本抽取待建档角色名（去重、主角优先、上限 6）。
 *
 * @param doc 结构化短剧脚本产物
 * @returns 角色名数组（保持首次出现顺序，主角在首位）
 */
export function extractProducerCharacterNames(doc: {
  protagonist: DramaScriptArtifact["protagonist"] | null | undefined;
  scenes: DramaScriptArtifact["scenes"];
}): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const add = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    ordered.push(name);
  };

  // 主角永远排第一
  const protagonist = extractProtagonistName(doc.protagonist);
  if (protagonist) add(protagonist);

  // 各场景对白说话人
  for (const scene of doc.scenes ?? []) {
    for (const speaker of extractSpeakersFromDialogue(scene.dialogue)) {
      add(speaker);
    }
  }

  return ordered.slice(0, MAX_PRODUCER_CHARACTERS);
}
