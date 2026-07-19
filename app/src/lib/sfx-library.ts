/**
 * 内置音效（SFX）库清单。
 *
 * 内置音效为固定静态资产，放在 `public/sfx/<category>/<file>.mp3`，
 * 随构建发布、由 Next static 直接服务，URL 形如 `/sfx/whoosh/whoosh-swift-1489.mp3`。
 * video-synthesis 的 absolutizeUrl() 会自动补成绝对地址给 ffmpeg 拉取——
 * 与 bgm-library / watermark / sticker 资产同机制，不入 DB、不走 storage.ts。
 *
 * 版权：全部来自 Mixkit（Mixkit License，商用免费、无需署名）。
 * sourceUrl 形如 https://assets.mixkit.co/active_storage/sfx/{id}/{id}-preview.mp3，
 * {id} 为文件名尾部数字。
 *
 * 新增音效：把 mp3 放到对应分类目录，并在 SFX_LIBRARY 追加一条即可；
 * 生产模式下 Next 只服务 build 时刻的 public 快照，build 后新增文件需重 build。
 */

/** 音效分类 id 白名单（前端分组、解析层枚举、导出校验共用单一真源） */
export type SfxCategory =
  | "whoosh"
  | "hit"
  | "slap"
  | "glass"
  | "heartbeat"
  | "riser"
  | "ambient";

/** 分类的中文标签 */
export interface SfxCategoryMeta {
  /** 分类 id */
  id: SfxCategory;
  /** 中文标签 */
  label: string;
}

/** 音效来源署名（合规留痕） */
export interface SfxCredit {
  /** 来源站点 */
  source: "Mixkit";
  /** 原始下载地址 */
  sourceUrl: string;
  /** 授权说明 */
  license: "Mixkit License (free commercial, no attribution)";
}

export interface SfxEntry {
  /** 稳定 id，如 "whoosh-swift"（前端回显选中态、解析层标签、导出关联用） */
  id: string;
  /** 中文标签，如 "疾风掠过" */
  label: string;
  /** 所属分类 */
  category: SfxCategory;
  /** 静态资源 URL，如 "/sfx/whoosh/whoosh-swift-1489.mp3" */
  file: string;
  /** 时长（秒），用于 UI 显示与试听进度 */
  durationSec: number;
  /** 来源署名 */
  credit: SfxCredit;
  /**
   * 默认音量 0-1（相对原始音效）。
   * 一次性击打类保守取 ~0.7（突出但不刺耳）；环境铺底类取 ~0.35（在对白之下）。
   */
  defaultVolume: number;
}

/** 七类音效分类（中文标签） */
export const SFX_CATEGORIES: SfxCategoryMeta[] = [
  { id: "whoosh", label: "疾风 / 转场" },
  { id: "hit", label: "重击 / 撞击" },
  { id: "slap", label: "拍击 / 掌掴" },
  { id: "glass", label: "玻璃破碎" },
  { id: "heartbeat", label: "心跳" },
  { id: "riser", label: "情绪推进" },
  { id: "ambient", label: "环境氛围" },
];

/** Mixkit sourceUrl 拼接（{id} = 文件名尾部数字） */
function mixkitUrl(id: number): string {
  return `https://assets.mixkit.co/active_storage/sfx/${id}/${id}-preview.mp3`;
}

/** Mixkit 授权（全库统一） */
function mixkitCredit(id: number): SfxCredit {
  return {
    source: "Mixkit",
    sourceUrl: mixkitUrl(id),
    license: "Mixkit License (free commercial, no attribution)",
  };
}

/**
 * 内置音效清单。
 *
 * 曲源：Mixkit（免费商用、无需署名）批量下载，实体在 public/sfx/<category>/。
 * 清单与实体文件名一一对应。新增：放 mp3 到对应目录 + 此处追加一条 + 重新 build。
 */
export const SFX_LIBRARY: SfxEntry[] = [
  // ── 疾风 / 转场（一次性，突出）──────────────────────────────
  {
    id: "whoosh-swift",
    label: "疾风掠过",
    category: "whoosh",
    file: "/sfx/whoosh/whoosh-swift-1489.mp3",
    durationSec: 2.3,
    credit: mixkitCredit(1489),
    defaultVolume: 0.7,
  },
  {
    id: "whoosh-fast",
    label: "快速呼啸",
    category: "whoosh",
    file: "/sfx/whoosh/whoosh-fast-1492.mp3",
    durationSec: 1.3,
    credit: mixkitCredit(1492),
    defaultVolume: 0.7,
  },
  {
    id: "whoosh-swish",
    label: "轻挥破空",
    category: "whoosh",
    file: "/sfx/whoosh/whoosh-swish-166.mp3",
    durationSec: 0.8,
    credit: mixkitCredit(166),
    defaultVolume: 0.7,
  },
  {
    id: "whoosh-long",
    label: "长音气流",
    category: "whoosh",
    file: "/sfx/whoosh/whoosh-long-1714.mp3",
    durationSec: 4.7,
    credit: mixkitCredit(1714),
    defaultVolume: 0.6,
  },
  // ── 重击 / 撞击 ────────────────────────────────────────────
  {
    id: "hit-punch",
    label: "拳击重拳",
    category: "hit",
    file: "/sfx/hit/hit-punch-2047.mp3",
    durationSec: 1.3,
    credit: mixkitCredit(2047),
    defaultVolume: 0.7,
  },
  {
    id: "hit-impact",
    label: "沉重撞击",
    category: "hit",
    file: "/sfx/hit/hit-impact-2198.mp3",
    durationSec: 3.0,
    credit: mixkitCredit(2198),
    defaultVolume: 0.7,
  },
  // ── 拍击 / 掌掴 ────────────────────────────────────────────
  {
    id: "slap-strike",
    label: "响亮耳光",
    category: "slap",
    file: "/sfx/slap/slap-strike-2155.mp3",
    durationSec: 1.7,
    credit: mixkitCredit(2155),
    defaultVolume: 0.7,
  },
  {
    id: "slap-quick",
    label: "快速拍击",
    category: "slap",
    file: "/sfx/slap/slap-quick-2161.mp3",
    durationSec: 1.3,
    credit: mixkitCredit(2161),
    defaultVolume: 0.7,
  },
  // ── 玻璃破碎 ──────────────────────────────────────────────
  {
    id: "glass-shatter",
    label: "玻璃粉碎",
    category: "glass",
    file: "/sfx/glass/glass-shatter-1317.mp3",
    durationSec: 0.4,
    credit: mixkitCredit(1317),
    defaultVolume: 0.7,
  },
  {
    id: "glass-break",
    label: "玻璃碎裂",
    category: "glass",
    file: "/sfx/glass/glass-break-759.mp3",
    durationSec: 1.4,
    credit: mixkitCredit(759),
    defaultVolume: 0.7,
  },
  // ── 心跳（略长，情绪铺底但仍属一次性触发）────────────────────
  {
    id: "heartbeat-loop",
    label: "紧张心跳",
    category: "heartbeat",
    file: "/sfx/heartbeat/heartbeat-loop-488.mp3",
    durationSec: 8.1,
    credit: mixkitCredit(488),
    defaultVolume: 0.5,
  },
  // ── 情绪推进（riser，铺垫高潮）─────────────────────────────
  {
    id: "riser-transition",
    label: "上升推进",
    category: "riser",
    file: "/sfx/riser/riser-transition-2290.mp3",
    durationSec: 7.1,
    credit: mixkitCredit(2290),
    defaultVolume: 0.5,
  },
  // ── 环境氛围（铺底，压到对白之下）───────────────────────────
  {
    id: "ambient-rain",
    label: "雨声",
    category: "ambient",
    file: "/sfx/ambient/ambient-rain-2393.mp3",
    durationSec: 15,
    credit: mixkitCredit(2393),
    defaultVolume: 0.35,
  },
  {
    id: "ambient-street",
    label: "街道喧嚣",
    category: "ambient",
    file: "/sfx/ambient/ambient-street-1554.mp3",
    durationSec: 14,
    credit: mixkitCredit(1554),
    defaultVolume: 0.35,
  },
  {
    id: "ambient-night-crickets",
    label: "夜晚虫鸣",
    category: "ambient",
    file: "/sfx/ambient/ambient-night-crickets-39.mp3",
    durationSec: 15,
    credit: mixkitCredit(39),
    defaultVolume: 0.35,
  },
  {
    id: "ambient-thunder",
    label: "雷声",
    category: "ambient",
    file: "/sfx/ambient/ambient-thunder-1287.mp3",
    durationSec: 4.8,
    credit: mixkitCredit(1287),
    defaultVolume: 0.4,
  },
];

/** 按 id 取单个音效（未命中返回 undefined） */
export function getSfxById(id: string): SfxEntry | undefined {
  return SFX_LIBRARY.find((s) => s.id === id);
}

/** 按分类取音效列表 */
export function listSfxByCategory(category: SfxCategory): SfxEntry[] {
  return SFX_LIBRARY.filter((s) => s.category === category);
}

/**
 * 解析层可用的「音效标签」全集：所有具体音效 id + 七个分类 id。
 *
 * 解析层允许 LLM 用「具体音效 id」（如 "glass-shatter"）或「分类 id」（如
 * "whoosh"，交由导出端取该类第一个音效兜底）。校验/导出端据此判定标签合法。
 */
export const SFX_TAGS: string[] = [
  ...SFX_CATEGORIES.map((c) => c.id),
  ...SFX_LIBRARY.map((s) => s.id),
];

/**
 * 把「解析标签」解析为具体音效条目。
 * - 命中具体 id → 直接返回该音效；
 * - 命中分类 id → 返回该分类第一个音效（兜底）；
 * - 都未命中 → undefined。
 * 供导出端把解析产出的 tag 落到实际音频文件，前端「一键填充」同源使用。
 */
export function resolveSfxTag(tag: string): SfxEntry | undefined {
  const byId = getSfxById(tag);
  if (byId) return byId;
  const category = SFX_CATEGORIES.find((c) => c.id === tag);
  if (category) return listSfxByCategory(category.id)[0];
  return undefined;
}
