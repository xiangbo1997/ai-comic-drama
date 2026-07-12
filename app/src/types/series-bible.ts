/**
 * 系列故事圣经（SeriesStoryBible）——跨集永久记忆的数据契约。
 *
 * 对标动漫工业的「設定資料集」+「シリーズ構成」：世界观/美术/道具/角色状态/
 * 伏笔线/分集功能表全部沉淀成结构化数据，由史官（chronicler）LLM 每集收官后
 * 增量更新，再由单一预算化 reader（lib/series.ts#buildSeriesMemoryDigest）渲染
 * 注入到 4 个管线点。存 Series.storyBible（Json，默认 "{}"）。
 *
 * 容错原则：DB 里的 JSON 可能是老数据 / 半成品 / 史官写坏。zod 全程 .catch()
 * + 默认值，parseStoryBible 永不抛错，坏数据一律降级为空圣经。
 */

import { z } from "zod";

/** 悬念钩子五分类（爆款短剧结尾钩子类型） */
export const HOOK_TYPES = ["悬念", "反转", "情绪", "信息", "危机"] as const;
export type HookType = (typeof HOOK_TYPES)[number];

/** 伏笔/剧情线状态 */
export const THREAD_STATUSES = ["open", "resolved"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/**
 * 世界观设定（美术/规则/纪元/视觉基调）。
 * 全部可选：老系列没有这一段，新系列由史官逐集补全。
 */
export interface WorldSetting {
  lore?: string;
  rules?: string;
  era?: string;
  visualGuideline?: string;
}

/** 美术设定：既定场景（保证跨集同一地点画风统一） */
export interface BibleLocation {
  name: string;
  description: string;
  mood?: string;
}

/** 道具/线索设定（含首次出现集数，便于回收伏笔） */
export interface BibleProp {
  name: string;
  description: string;
  firstEpisode?: number;
}

/**
 * 角色叙事状态（视觉锚点仍在 Character 表；这里只存「剧情态」）。
 * forbiddenChanges：史官/解析层都不得违背的硬约束（如「已失去左臂」）。
 */
export interface BibleCharacter {
  name: string;
  state: string;
  relationships?: string;
  arc?: string;
  forbiddenChanges?: string;
  lastSeenEpisode?: number;
}

/** 伏笔/剧情线（plant → resolve 生命周期） */
export interface BibleThread {
  id: string;
  title: string;
  status: ThreadStatus;
  plantedEpisode: number;
  resolvedEpisode?: number;
  note?: string;
}

/** 分集功能表：每集在整部剧里承担的叙事功能 */
export interface BibleEpisode {
  episodeNumber: number;
  title: string;
  logline: string;
  protagonistChange?: string;
  endingHook: string;
  hookType?: HookType;
  newLore?: string;
}

/**
 * 色彩指定（color script / 色指定表）——对标动漫工业的「色彩設計」工种。
 * 一份 series 级锁定的主色板：整部剧统一色调，出图必须遵守，消除「每镜色调各异」。
 * 全部可选：老系列没有这一段，由史官逐集补全 / 由用户在圣经里锁定。
 */
export interface ColorScript {
  /** 主色板（英文色彩描述，如 "warm amber" / "deep teal shadow"），建议 3-6 个 */
  keyColors?: string[];
  /** 整体色调基调（如 "desaturated cinematic teal-and-orange"） */
  overallTone?: string;
  /** 情绪 → 色调映射（如 {mood:"tense", palette:"cold blue with harsh contrast"}） */
  moodPalettes?: Array<{ mood: string; palette: string }>;
}

/** 系列故事圣经主体 */
export interface SeriesStoryBible {
  version: 1;
  /** 一句话主题锁（シリーズ構成：全集服务它） */
  theme?: string;
  worldSetting?: WorldSetting;
  /** 色彩指定（全片统一主色板；出图注入、视觉评审据此判色调一致性） */
  colorScript?: ColorScript;
  locations: BibleLocation[];
  props: BibleProp[];
  characters: BibleCharacter[];
  threads: BibleThread[];
  episodes: BibleEpisode[];
  updatedAt: string;
}

// ============ Zod schema（容错解析） ============

const WorldSettingSchema = z
  .object({
    lore: z.string().optional().catch(undefined),
    rules: z.string().optional().catch(undefined),
    era: z.string().optional().catch(undefined),
    visualGuideline: z.string().optional().catch(undefined),
  })
  .catch({});

const LocationSchema = z.object({
  name: z.string(),
  description: z.string().catch(""),
  mood: z.string().optional().catch(undefined),
});

const PropSchema = z.object({
  name: z.string(),
  description: z.string().catch(""),
  firstEpisode: z.number().int().optional().catch(undefined),
});

const CharacterSchema = z.object({
  name: z.string(),
  state: z.string().catch(""),
  relationships: z.string().optional().catch(undefined),
  arc: z.string().optional().catch(undefined),
  forbiddenChanges: z.string().optional().catch(undefined),
  lastSeenEpisode: z.number().int().optional().catch(undefined),
});

const ThreadSchema = z.object({
  id: z.string(),
  title: z.string().catch(""),
  status: z.enum(THREAD_STATUSES).catch("open"),
  plantedEpisode: z.number().int().catch(1),
  resolvedEpisode: z.number().int().optional().catch(undefined),
  note: z.string().optional().catch(undefined),
});

const EpisodeSchema = z.object({
  episodeNumber: z.number().int(),
  title: z.string().catch(""),
  logline: z.string().catch(""),
  protagonistChange: z.string().optional().catch(undefined),
  endingHook: z.string().catch(""),
  hookType: z.enum(HOOK_TYPES).optional().catch(undefined),
  newLore: z.string().optional().catch(undefined),
});

/** 单条情绪→色调映射（坏条目由外层数组 .catch(null) 剔除） */
const MoodPaletteSchema = z.object({
  mood: z.string(),
  palette: z.string().catch(""),
});

/**
 * 色彩指定 schema：整体 .catch(undefined) 兜底；
 * keyColors 逐元素校验、数组整体 .catch([]) 保证坏数据降级空数组。
 */
const ColorScriptSchema = z
  .object({
    keyColors: z
      .array(z.string().nullable().catch(null))
      .catch([])
      .optional()
      .catch(undefined),
    overallTone: z.string().optional().catch(undefined),
    moodPalettes: z
      .array(MoodPaletteSchema.nullable().catch(null))
      .catch([])
      .optional()
      .catch(undefined),
  })
  .catch({});

/**
 * 圣经 schema：数组字段整体 .catch([]) 兜底（哪怕某一条烂掉也不整块丢）；
 * 单条对象里的必填 name/id 缺失会让该条被 array 的元素校验丢弃，其余保留。
 */
const SeriesStoryBibleSchema = z.object({
  version: z.literal(1).catch(1),
  theme: z.string().optional().catch(undefined),
  worldSetting: WorldSettingSchema.optional().catch(undefined),
  colorScript: ColorScriptSchema.optional().catch(undefined),
  locations: z.array(LocationSchema.nullable().catch(null)).catch([]),
  props: z.array(PropSchema.nullable().catch(null)).catch([]),
  characters: z.array(CharacterSchema.nullable().catch(null)).catch([]),
  threads: z.array(ThreadSchema.nullable().catch(null)).catch([]),
  episodes: z.array(EpisodeSchema.nullable().catch(null)).catch([]),
  updatedAt: z.string().catch(""),
});

/** 空圣经常量工厂（每次新建，避免共享可变引用） */
export function emptyBible(): SeriesStoryBible {
  return {
    version: 1,
    locations: [],
    props: [],
    characters: [],
    threads: [],
    episodes: [],
    updatedAt: "",
  };
}

/** 从数组里剔除 .catch(null) 产生的 null（坏条目） */
function compact<T>(arr: Array<T | null>): T[] {
  return arr.filter((x): x is T => x !== null);
}

/**
 * 清洗色彩指定：剔除 keyColors/moodPalettes 里的坏条目（null）与空串。
 * 全空时返回 undefined，让 colorScript 字段直接缺席（与「无该字段」等价）。
 */
function cleanColorScript(
  raw:
    | {
        keyColors?: Array<string | null>;
        overallTone?: string;
        moodPalettes?: Array<{ mood: string; palette: string } | null>;
      }
    | undefined
): ColorScript | undefined {
  if (!raw) return undefined;
  const keyColors = raw.keyColors
    ? compact(raw.keyColors).filter((c) => c.trim().length > 0)
    : [];
  const moodPalettes = raw.moodPalettes
    ? compact(raw.moodPalettes).filter((m) => m.mood.trim().length > 0)
    : [];
  const overallTone = raw.overallTone?.trim() ? raw.overallTone : undefined;

  if (keyColors.length === 0 && moodPalettes.length === 0 && !overallTone) {
    return undefined;
  }
  return {
    ...(keyColors.length > 0 ? { keyColors } : {}),
    ...(overallTone ? { overallTone } : {}),
    ...(moodPalettes.length > 0 ? { moodPalettes } : {}),
  };
}

/**
 * 解析任意 JSON 为 SeriesStoryBible，永不抛错。
 * 垃圾 / 空 / 半成品输入统一降级为空圣经；合法输入原样往返（坏条目被剔除）。
 */
export function parseStoryBible(json: unknown): SeriesStoryBible {
  const result = SeriesStoryBibleSchema.safeParse(json);
  if (!result.success) return emptyBible();
  const b = result.data;
  return {
    version: 1,
    theme: b.theme,
    worldSetting: b.worldSetting,
    colorScript: cleanColorScript(b.colorScript),
    locations: compact(b.locations),
    props: compact(b.props),
    characters: compact(b.characters),
    threads: compact(b.threads),
    episodes: compact(b.episodes),
    updatedAt: b.updatedAt,
  };
}

/** 圣经是否为空（无任何可注入的记忆内容） */
export function isBibleEmpty(bible: SeriesStoryBible): boolean {
  return (
    !bible.theme &&
    !bible.worldSetting &&
    !bible.colorScript &&
    bible.locations.length === 0 &&
    bible.props.length === 0 &&
    bible.characters.length === 0 &&
    bible.threads.length === 0 &&
    bible.episodes.length === 0
  );
}
