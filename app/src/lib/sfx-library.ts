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
  | "comedy"
  | "reaction"
  | "suspense"
  | "combat"
  | "daily"
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

/**
 * 音效分类（中文标签）。
 *
 * 2026-07-20 对标剪映内置音效库扩容：新增 综艺搞笑 / 观众反应 / 悬疑惊悚 /
 * 打斗爆破 / 日常拟声 五类（对应剪映的 综艺、笑声/掌声、悬疑、打斗、拟声 分区），
 * 素材仍全部来自 Mixkit 免费商用授权——剪映自带音频是字节跳动版权素材不可直搬，
 * 这里搬的是「分类体系 + 等价免费素材」。
 */
export const SFX_CATEGORIES: SfxCategoryMeta[] = [
  { id: "whoosh", label: "疾风 / 转场" },
  { id: "hit", label: "重击 / 撞击" },
  { id: "slap", label: "拍击 / 掌掴" },
  { id: "glass", label: "玻璃破碎" },
  { id: "heartbeat", label: "心跳" },
  { id: "riser", label: "情绪推进" },
  { id: "comedy", label: "综艺搞笑" },
  { id: "reaction", label: "观众反应" },
  { id: "suspense", label: "悬疑惊悚" },
  { id: "combat", label: "打斗爆破" },
  { id: "daily", label: "日常拟声" },
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
  // ── 综艺搞笑（对标剪映综艺分区：梗音/滑稽标点，一次性突出）──────
  {
    id: "comedy-boing",
    label: "弹簧滑稽",
    category: "comedy",
    file: "/sfx/comedy/comedy-boing-2894.mp3",
    durationSec: 1.2,
    credit: mixkitCredit(2894),
    defaultVolume: 0.7,
  },
  {
    id: "comedy-fail-trumpet",
    label: "失败长号",
    category: "comedy",
    file: "/sfx/comedy/comedy-fail-trumpet-744.mp3",
    durationSec: 2.7,
    credit: mixkitCredit(744),
    defaultVolume: 0.7,
  },
  {
    id: "comedy-ding",
    label: "答对叮咚",
    category: "comedy",
    file: "/sfx/comedy/comedy-ding-2870.mp3",
    durationSec: 2.0,
    credit: mixkitCredit(2870),
    defaultVolume: 0.6,
  },
  {
    id: "comedy-rimshot",
    label: "捧哏鼓点",
    category: "comedy",
    file: "/sfx/comedy/comedy-rimshot-578.mp3",
    durationSec: 2.0,
    credit: mixkitCredit(578),
    defaultVolume: 0.7,
  },
  {
    id: "comedy-fall-whistle",
    label: "坠落口哨",
    category: "comedy",
    file: "/sfx/comedy/comedy-fall-whistle-395.mp3",
    durationSec: 2.7,
    credit: mixkitCredit(395),
    defaultVolume: 0.7,
  },
  {
    id: "comedy-scream-fall",
    label: "综艺惨叫",
    category: "comedy",
    file: "/sfx/comedy/comedy-scream-fall-392.mp3",
    durationSec: 3.0,
    credit: mixkitCredit(392),
    defaultVolume: 0.65,
  },
  // ── 观众反应（对标剪映笑声/掌声分区：群体反应，半铺底）──────────
  {
    id: "reaction-crowd-laugh",
    label: "哄堂大笑",
    category: "reaction",
    file: "/sfx/reaction/reaction-crowd-laugh-424.mp3",
    durationSec: 4.1,
    credit: mixkitCredit(424),
    defaultVolume: 0.55,
  },
  {
    id: "reaction-applause",
    label: "掌声雷动",
    category: "reaction",
    file: "/sfx/reaction/reaction-applause-485.mp3",
    durationSec: 11.9,
    credit: mixkitCredit(485),
    defaultVolume: 0.55,
  },
  {
    id: "reaction-cheer",
    label: "欢呼喝彩",
    category: "reaction",
    file: "/sfx/reaction/reaction-cheer-462.mp3",
    durationSec: 10.1,
    credit: mixkitCredit(462),
    defaultVolume: 0.55,
  },
  // ── 悬疑惊悚（对标剪映悬疑分区：戛止重音/低鸣铺底/倒计时）────────
  {
    id: "suspense-sting",
    label: "悬疑戛止",
    category: "suspense",
    file: "/sfx/suspense/suspense-sting-565.mp3",
    durationSec: 4.1,
    credit: mixkitCredit(565),
    defaultVolume: 0.6,
  },
  {
    id: "suspense-drone",
    label: "阴森低鸣",
    category: "suspense",
    file: "/sfx/suspense/suspense-drone-2482.mp3",
    durationSec: 15,
    credit: mixkitCredit(2482),
    defaultVolume: 0.4,
  },
  {
    id: "suspense-tick",
    label: "倒计时滴答",
    category: "suspense",
    file: "/sfx/suspense/suspense-tick-1045.mp3",
    durationSec: 12,
    credit: mixkitCredit(1045),
    defaultVolume: 0.45,
  },
  // ── 打斗爆破（对标剪映打斗分区）────────────────────────────────
  {
    id: "combat-sword",
    label: "刀剑交击",
    category: "combat",
    file: "/sfx/combat/combat-sword-2160.mp3",
    durationSec: 1.3,
    credit: mixkitCredit(2160),
    defaultVolume: 0.7,
  },
  {
    id: "combat-explosion",
    label: "爆炸轰鸣",
    category: "combat",
    file: "/sfx/combat/combat-explosion-1704.mp3",
    durationSec: 8.4,
    credit: mixkitCredit(1704),
    defaultVolume: 0.7,
  },
  {
    id: "combat-bomb",
    label: "远处炸响",
    category: "combat",
    file: "/sfx/combat/combat-bomb-2804.mp3",
    durationSec: 8.0,
    credit: mixkitCredit(2804),
    defaultVolume: 0.65,
  },
  // ── 日常拟声（对标剪映拟声/电子分区：生活声音事件）──────────────
  {
    id: "daily-door-knock",
    label: "敲门声",
    category: "daily",
    file: "/sfx/daily/daily-door-knock-197.mp3",
    durationSec: 1.1,
    credit: mixkitCredit(197),
    defaultVolume: 0.7,
  },
  {
    id: "daily-door-slam",
    label: "摔门而去",
    category: "daily",
    file: "/sfx/daily/daily-door-slam-194.mp3",
    durationSec: 1.7,
    credit: mixkitCredit(194),
    defaultVolume: 0.7,
  },
  {
    id: "daily-phone-ring",
    label: "电话铃响",
    category: "daily",
    file: "/sfx/daily/daily-phone-ring-1350.mp3",
    durationSec: 1.1,
    credit: mixkitCredit(1350),
    defaultVolume: 0.6,
  },
  {
    id: "daily-message-pop",
    label: "消息提示",
    category: "daily",
    file: "/sfx/daily/daily-message-pop-2354.mp3",
    durationSec: 1.1,
    credit: mixkitCredit(2354),
    defaultVolume: 0.6,
  },
  {
    id: "daily-camera-shutter",
    label: "相机快门",
    category: "daily",
    file: "/sfx/daily/daily-camera-shutter-1133.mp3",
    durationSec: 0.4,
    credit: mixkitCredit(1133),
    defaultVolume: 0.7,
  },
  {
    id: "daily-footsteps",
    label: "脚步声",
    category: "daily",
    file: "/sfx/daily/daily-footsteps-542.mp3",
    durationSec: 5.2,
    credit: mixkitCredit(542),
    defaultVolume: 0.55,
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
  {
    id: "ambient-wind",
    label: "风声",
    category: "ambient",
    file: "/sfx/ambient/ambient-wind-2658.mp3",
    durationSec: 15,
    credit: mixkitCredit(2658),
    defaultVolume: 0.35,
  },
  {
    id: "ambient-birds",
    label: "清晨鸟鸣",
    category: "ambient",
    file: "/sfx/ambient/ambient-birds-2472.mp3",
    durationSec: 15,
    credit: mixkitCredit(2472),
    defaultVolume: 0.35,
  },
  {
    id: "ambient-cafe",
    label: "餐厅人声",
    category: "ambient",
    file: "/sfx/ambient/ambient-cafe-444.mp3",
    durationSec: 15,
    credit: mixkitCredit(444),
    defaultVolume: 0.35,
  },
  {
    id: "ambient-fire",
    label: "篝火噼啪",
    category: "ambient",
    file: "/sfx/ambient/ambient-fire-1329.mp3",
    durationSec: 14.1,
    credit: mixkitCredit(1329),
    defaultVolume: 0.35,
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
 * 解析层可用的「音效标签」全集：所有具体音效 id + 全部分类 id。
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
