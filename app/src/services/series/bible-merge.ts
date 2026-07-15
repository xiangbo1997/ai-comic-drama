/**
 * 故事圣经合并（纯函数，全量单测覆盖）。
 *
 * 史官 LLM 每集产出一份「本集抽取」（ChronicleExtraction），mergeBible 把它
 * 不可变地并进当前圣经：
 * - 分集功能表按 episodeNumber upsert（重跑同一集 = 替换，幂等）
 * - 角色按名字大小写不敏感 upsert（已有则更新状态，无则新增）
 * - 伏笔线生命周期：新线分配 id 并入队，resolvedThreadTitles 命中的线置 resolved
 * - 场景/道具按名字去重
 * - 上限：threads/locations/props ≤ 30（超限先丢最老的已解决线 / 最老条目），
 *   episodes 全保留（很小），角色状态字段截断
 * - theme 仅在缺失时设置（一旦锁定不再变）
 */

import type {
  SeriesStoryBible,
  BibleThread,
  BibleCharacter,
  BibleLocation,
  BibleProp,
  BibleEpisode,
  HookType,
} from "@/types/series-bible";

/** 史官单集抽取产物（LLM 输出，已 zod 校验） */
export interface ChronicleExtraction {
  episodeEntry: {
    title: string;
    logline: string;
    protagonistChange?: string;
    endingHook: string;
    hookType?: HookType;
  };
  characterUpdates: Array<{
    name: string;
    state: string;
    relationships?: string;
    arc?: string;
    forbiddenChanges?: string;
  }>;
  newThreads: Array<{ title: string; note?: string }>;
  resolvedThreadTitles: string[];
  newLocations: Array<{ name: string; description: string; mood?: string }>;
  newProps: Array<{ name: string; description: string }>;
  loreAdditions: string[];
  /** 主题提案：仅第 1 集（且圣经尚无 theme）时采纳 */
  themeProposal?: string;
}

// ============ 字段上限（防圣经无限膨胀，控 digest 预算） ============
const MAX_THREADS = 30;
const MAX_LOCATIONS = 30;
const MAX_PROPS = 30;
const CHAR_STATE_MAX_CHARS = 120;
const CHAR_FIELD_MAX_CHARS = 120;
const LORE_MAX_CHARS = 400;

function slice(text: string | undefined, max: number): string | undefined {
  if (text == null) return undefined;
  const t = text.trim();
  if (t.length === 0) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

/** 生成伏笔线 id：thread-<集数>-<该集内序号> */
function threadId(episodeNumber: number, seq: number): string {
  return `thread-${episodeNumber}-${seq}`;
}

/** upsert 分集功能表：同 episodeNumber 替换，否则新增（保持升序） */
function upsertEpisode(
  episodes: BibleEpisode[],
  entry: BibleEpisode
): BibleEpisode[] {
  const others = episodes.filter(
    (e) => e.episodeNumber !== entry.episodeNumber
  );
  return [...others, entry].sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/** upsert 角色（名字大小写不敏感）：已有则合并新值，无则新增 */
function upsertCharacters(
  current: BibleCharacter[],
  updates: ChronicleExtraction["characterUpdates"],
  episodeNumber: number
): BibleCharacter[] {
  const result = [...current];
  for (const u of updates) {
    const name = u.name?.trim();
    if (!name) continue;
    const state = slice(u.state, CHAR_STATE_MAX_CHARS) ?? "";
    const idx = result.findIndex(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (idx >= 0) {
      const prev = result[idx];
      result[idx] = {
        ...prev,
        state: state || prev.state,
        relationships:
          slice(u.relationships, CHAR_FIELD_MAX_CHARS) ?? prev.relationships,
        arc: slice(u.arc, CHAR_FIELD_MAX_CHARS) ?? prev.arc,
        forbiddenChanges:
          slice(u.forbiddenChanges, CHAR_FIELD_MAX_CHARS) ??
          prev.forbiddenChanges,
        lastSeenEpisode: episodeNumber,
      };
    } else {
      result.push({
        name,
        state,
        relationships: slice(u.relationships, CHAR_FIELD_MAX_CHARS),
        arc: slice(u.arc, CHAR_FIELD_MAX_CHARS),
        forbiddenChanges: slice(u.forbiddenChanges, CHAR_FIELD_MAX_CHARS),
        lastSeenEpisode: episodeNumber,
      });
    }
  }
  return result;
}

/**
 * 应用伏笔线变更：先按标题解决已有 open 线，再追加本集新线。
 * 超上限时优先丢最老的已解决线（open 线永远保留，它们是待回收记忆）。
 */
function applyThreads(
  current: BibleThread[],
  ext: ChronicleExtraction,
  episodeNumber: number
): BibleThread[] {
  // 1. 解决命中标题的 open 线（大小写不敏感）
  const resolveSet = new Set(
    ext.resolvedThreadTitles
      .map((t) => t?.trim().toLowerCase())
      .filter((t): t is string => Boolean(t))
  );
  let threads = current.map((t) =>
    t.status === "open" && resolveSet.has(t.title.toLowerCase())
      ? { ...t, status: "resolved" as const, resolvedEpisode: episodeNumber }
      : t
  );

  // 2. 追加本集新线（去重：标题已存在的不重复埋）
  const existingTitles = new Set(threads.map((t) => t.title.toLowerCase()));
  let seq = 0;
  for (const nt of ext.newThreads) {
    const title = nt.title?.trim();
    if (!title || existingTitles.has(title.toLowerCase())) continue;
    seq += 1;
    threads.push({
      id: threadId(episodeNumber, seq),
      title,
      status: "open",
      plantedEpisode: episodeNumber,
      note: slice(nt.note, CHAR_FIELD_MAX_CHARS),
    });
    existingTitles.add(title.toLowerCase());
  }

  // 3. 超上限：从最老的已解决线开始丢
  if (threads.length > MAX_THREADS) {
    const resolved = threads.filter((t) => t.status === "resolved");
    const open = threads.filter((t) => t.status === "open");
    const dropCount = threads.length - MAX_THREADS;
    // 已解决线按 resolvedEpisode 升序（最老先丢）
    const keptResolved = [...resolved]
      .sort((a, b) => (a.resolvedEpisode ?? 0) - (b.resolvedEpisode ?? 0))
      .slice(dropCount);
    threads = [...open, ...keptResolved];
    // 若丢完已解决线仍超限（open 线太多），再从最老 open 线丢
    if (threads.length > MAX_THREADS) {
      threads = [...threads]
        .sort((a, b) => a.plantedEpisode - b.plantedEpisode)
        .slice(threads.length - MAX_THREADS);
    }
  }

  return threads;
}

/** 按 name 去重合并（大小写不敏感）；已存在的不覆盖，超上限丢最老（数组尾部为新） */
function mergeByName<T extends { name: string }>(
  current: T[],
  additions: T[],
  max: number
): T[] {
  const result = [...current];
  const seen = new Set(result.map((x) => x.name.toLowerCase()));
  for (const a of additions) {
    const name = a.name?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    result.push(a);
    seen.add(name.toLowerCase());
  }
  return result.length > max ? result.slice(result.length - max) : result;
}

/**
 * 把史官抽取不可变地合并进当前圣经。
 * @param current 当前圣经（不被修改）
 * @param extraction 本集抽取
 * @param episodeNumber 本集集数
 * @returns 新圣经
 */
export function mergeBible(
  current: SeriesStoryBible,
  extraction: ChronicleExtraction,
  episodeNumber: number
): SeriesStoryBible {
  // 分集功能表 upsert（幂等：重跑替换）
  const episodeEntry: BibleEpisode = {
    episodeNumber,
    title: extraction.episodeEntry.title?.trim() ?? "",
    logline: extraction.episodeEntry.logline?.trim() ?? "",
    protagonistChange: slice(
      extraction.episodeEntry.protagonistChange,
      CHAR_FIELD_MAX_CHARS
    ),
    endingHook: extraction.episodeEntry.endingHook?.trim() ?? "",
    hookType: extraction.episodeEntry.hookType,
    newLore: extraction.loreAdditions.length
      ? slice(extraction.loreAdditions.join("；"), LORE_MAX_CHARS)
      : undefined,
  };
  const episodes = upsertEpisode(current.episodes, episodeEntry);

  const characters = upsertCharacters(
    current.characters,
    extraction.characterUpdates,
    episodeNumber
  );

  const threads = applyThreads(current.threads, extraction, episodeNumber);

  const newLocations: BibleLocation[] = extraction.newLocations
    .filter((l) => l.name?.trim())
    .map((l) => ({
      name: l.name.trim(),
      description: slice(l.description, CHAR_FIELD_MAX_CHARS) ?? "",
      mood: slice(l.mood, 60),
    }));
  const locations = mergeByName(current.locations, newLocations, MAX_LOCATIONS);

  const newProps: BibleProp[] = extraction.newProps
    .filter((p) => p.name?.trim())
    .map((p) => ({
      name: p.name.trim(),
      description: slice(p.description, CHAR_FIELD_MAX_CHARS) ?? "",
      firstEpisode: episodeNumber,
    }));
  const props = mergeByName(current.props, newProps, MAX_PROPS);

  // 世界观 lore 累加（追加本集新增，去重靠简单包含判断）
  let worldSetting = current.worldSetting;
  const loreText = slice(extraction.loreAdditions.join("；"), LORE_MAX_CHARS);
  if (loreText) {
    const prevLore = current.worldSetting?.lore ?? "";
    const mergedLore = prevLore.includes(loreText)
      ? prevLore
      : slice([prevLore, loreText].filter(Boolean).join("；"), LORE_MAX_CHARS);
    worldSetting = { ...current.worldSetting, lore: mergedLore };
  }

  // 主题只在缺失时锁定
  const theme =
    current.theme ?? slice(extraction.themeProposal, CHAR_FIELD_MAX_CHARS);

  return {
    version: 1,
    theme,
    worldSetting,
    // 色彩指定（color script）：史官不产出该字段，属用户在圣经里手动锁定的全片主色板。
    // 归档时必须原样保留，否则每集归档整体覆盖 storyBible 会把用户锁的色板抹掉。
    colorScript: current.colorScript,
    locations,
    props,
    characters,
    threads,
    episodes,
    updatedAt: new Date().toISOString(),
  };
}
