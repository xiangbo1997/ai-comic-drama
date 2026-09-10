/**
 * 题材适配矩阵 —— AI 漫剧题材选择的单一真源（批 3 · 题材蓝海引导）
 *
 * 为什么存在：爆款方法论层（lib/prompts/episode-structure.ts 的开场钩子 / 节奏骨架 /
 * 打脸四步 / 五类结尾钩子 / 反转三式）已经很厚，但用户侧**没有任何「选套路」的旋钮**——
 * 题材完全无引导。本文件把有数据支撑的题材强结论变成产品引导：
 *   ① UI 侧：选题材时同屏给出数据依据与风险提示（只给信息，不硬阻断）；
 *   ② Prompt 侧：题材作为**补充上下文**注入起草/脚本 prompt（不替换既有方法论规则）。
 *
 * ⚠️ 依赖纪律：本文件零导入其它 app 代码（客户端组件会 import 它），
 * 必须无副作用、无外部依赖，仅纯数据 + 纯函数（同 prompts/style-packs.ts 的约定）。
 *
 * ⚠️ 数据纪律：每条结论都标注来源与置信度。低置信的数字**不写成硬规则**，
 * 只作为提示文案；任何档位都不阻断用户选择（产品哲学见 lib/character-finalized.ts）。
 *
 * 数据来源汇总（2026-09 调研，已交叉验证）：
 * - DataEye《2026H1 短剧 / AI 漫剧投放与供给报告》：漫剧各题材部数、播放量、投放占比；
 * - 抖音漫剧官方分账规则（2026-04-30 生效版）：分账公式与品类系数；
 * - 艾媒咨询 AI 动漫用户调研 + 微博舆情（「模板脸」话题阅读 5200 万）：弃剧归因；
 * - 公开爆款案例播放/收藏数据（抖音站内可见计数）。
 */

/**
 * 题材推荐档位（数组顺序即推荐强度，UI 按档分组展示）。
 *
 * - `first-choice`   首选：AI 漫剧的能力优势区，真人短剧做不到或成本不可行；
 * - `recommended`    推荐：已有破亿级验证案例，竞争尚不饱和；
 * - `blue-ocean`     蓝海待验证：供给少但热度高，存在风险变量（恐怖谷 / 现实参照）；
 * - `red-ocean`      红海慎入：供给与投放高度饱和，标签泛滥；
 * - `not-advised`    不建议：供需倒挂，漫剧供给多但播放不匹配；
 * - `avoid`          避开：AI 人脸恐怖谷被现实参照放大，且正面对撞成熟真人短剧；
 * - `prohibited`     禁止：平台层面明确不要的品类（分账系数已被砍）。
 */
export type GenreTier =
  | "first-choice"
  | "recommended"
  | "blue-ocean"
  | "red-ocean"
  | "not-advised"
  | "avoid"
  | "prohibited";

/** 结论置信度：来源数量与一致性（high=多源交叉一致；low=单源或口径存疑） */
export type GenreConfidence = "high" | "medium" | "low";

/** 档位展示元信息（UI 分组标题 + 色彩语义 + 一句话定位） */
export interface GenreTierMeta {
  tier: GenreTier;
  /** 分组标题（UI 显示） */
  label: string;
  /** 星级符号，沿用调研报告的表达 */
  stars: string;
  /** 一句话定位（分组副标题） */
  summary: string;
  /**
   * 语义色：UI 据此上色。
   * good=推荐绿 / neutral=中性 / warn=警示黄 / danger=风险红。
   */
  severity: "good" | "neutral" | "warn" | "danger";
}

/** 单个题材条目 */
export interface GenreOption {
  /** 存储值（落 generationParams.genre），稳定 kebab-case id */
  id: string;
  /** 中文题材名（UI 显示 + 注入 prompt 的题材名） */
  label: string;
  /** 推荐档位 */
  tier: GenreTier;
  /**
   * 数据依据（UI 直接展示的一句话，必须带数字或案例）。
   * 这是「不是干巴巴下拉列表」的关键：每个选项都说清为什么。
   */
  rationale: string;
  /**
   * 风险 / 警告（仅风险档位有）。选到 avoid / prohibited / blue-ocean 时展示理由。
   * 有值即 UI 必须显示；但**不阻断**选择。
   */
  caution?: string;
  /**
   * 注入 LLM 的题材创作要点（中文，≤120 字）。
   * 只写「这个题材该怎么写才对」的正向指引，不重复 episode-structure 的通用方法论。
   */
  craftNote: string;
  /** 结论来源（简短引用，便于日后复核） */
  source: string;
  /** 结论置信度 */
  confidence: GenreConfidence;
}

/** 档位元信息注册表（数组顺序即 UI 分组顺序） */
export const GENRE_TIERS: readonly GenreTierMeta[] = [
  {
    tier: "first-choice",
    label: "首选",
    stars: "⭐⭐⭐⭐⭐",
    summary: "AI 漫剧的能力优势区：真人短剧做不到或成本不可行",
    severity: "good",
  },
  {
    tier: "recommended",
    label: "推荐",
    stars: "⭐⭐⭐⭐",
    summary: "已有破亿级验证案例，竞争尚不饱和",
    severity: "good",
  },
  {
    tier: "blue-ocean",
    label: "蓝海待验证",
    stars: "⭐⭐⭐",
    summary: "供给少、热度高，但存在风险变量，值得小步试水",
    severity: "neutral",
  },
  {
    tier: "red-ocean",
    label: "红海慎入",
    stars: "🔴",
    summary: "供给与投放高度饱和，同质化严重",
    severity: "warn",
  },
  {
    tier: "not-advised",
    label: "不建议",
    stars: "⭐⭐",
    summary: "漫剧供给已多但播放量不匹配，供需倒挂",
    severity: "warn",
  },
  {
    tier: "avoid",
    label: "避开",
    stars: "⭐",
    summary: "有现实参照时 AI 人脸的恐怖谷被放大，且正面对撞真人短剧",
    severity: "danger",
  },
  {
    tier: "prohibited",
    label: "平台不要",
    stars: "❌",
    summary: "平台分账规则已明确打压，做了也拿不到收益",
    severity: "danger",
  },
] as const;

/**
 * 题材矩阵注册表 —— 数组顺序即同档内的展示顺序。
 *
 * 组织原则：先首选（能力优势区）→ 推荐（已验证）→ 蓝海（试水）→
 * 红海/不建议/避开/禁止（风险递增）。
 */
export const GENRE_OPTIONS: readonly GenreOption[] = [
  // ========== 首选：AI 漫剧的能力优势区 ==========
  {
    id: "xuanhuan",
    label: "玄幻 / 仙侠 / 修真",
    tier: "first-choice",
    rationale:
      "宏大场景、法术特效、异兽，真人短剧的预算根本做不到；观众对非现实画风的容错率最高",
    craftNote:
      "境界/等级体系要可感知（越级打脸才有爽感）；法术与异兽必须是视觉奇观，不要写成口头交锋。",
    source: "DataEye 2026H1 报告 + AI 漫剧能力边界分析",
    confidence: "high",
  },
  {
    id: "zhanshen-kaihuang",
    label: "战神 / 开荒种田养成",
    tier: "first-choice",
    rationale:
      "标杆《发配边关，罪妻开荒养出战神》抖音累计播放 41 亿；养成线天然适合长连载",
    craftNote:
      "养成要有可量化的阶段跃迁（从无到有、从弱到强），每一集都让观众看见「又长了一截」。",
    source: "抖音站内公开播放数据（41 亿）",
    confidence: "high",
  },
  {
    id: "yineng",
    label: "异能（都市 + 幻想）",
    tier: "first-choice",
    rationale:
      "当前最大蓝海：漫剧端仅 193 部却有 30 亿播放，供需错配最严重的赛道",
    craftNote:
      "异能要有明确的规则与代价（无代价的异能没有张力）；都市外壳 + 幻想内核，奇观落在日常场景里。",
    source: "DataEye 2026H1 报告（193 部 / 30 亿播放）",
    confidence: "high",
  },
  {
    id: "moshi",
    label: "末世 / 废土科幻",
    tier: "first-choice",
    rationale:
      "《归墟》破亿验证；废土美学对 AI 生成友好，脏污质感能掩盖画面瑕疵",
    craftNote:
      "资源稀缺是一切冲突的源头；把「活下去」的代价写具体，避免空喊末世。",
    source: "公开爆款案例（《归墟》破亿）",
    confidence: "high",
  },

  // ========== 推荐：已有破亿验证 ==========
  {
    id: "guize-guaitan",
    label: "规则怪谈 / 无限流",
    tier: "recommended",
    rationale: "规则文本天然自带悬念钩子，与每集留钩的漫剧节奏高度契合",
    craftNote:
      "规则必须先亮出来再被打破（观众要能自己推理）；禁止临时加规则解决危机。",
    source: "竞品拆解 + 题材—节奏契合度分析",
    confidence: "medium",
  },
  {
    id: "mengbao-tuanchong",
    label: "萌宝 / 团宠",
    tier: "recommended",
    rationale: "《剑宗团宠小师妹》收藏 2000 万+；萌系画风是 AI 绘图的舒适区",
    craftNote:
      "团宠的爽点在「被偏爱的理由成立」——每次护短都要有前因，否则变成无脑吹捧。",
    source: "抖音站内公开收藏数据（2000 万+）",
    confidence: "high",
  },
  {
    id: "guofeng-zhiguai",
    label: "国风志怪",
    tier: "recommended",
    rationale: "《非妖哉》破亿；东方妖怪造型差异化强，不容易撞脸",
    craftNote:
      "妖怪要有人性困境（只有外形奇观会腻）；国风意象落在具体器物与习俗上。",
    source: "公开爆款案例（《非妖哉》破亿）",
    confidence: "high",
  },

  // ========== 蓝海待验证：供给少、热度高，但有风险变量 ==========
  {
    id: "heibang",
    label: "黑帮",
    tier: "blue-ocean",
    rationale: "短剧数仅 1900-2500 部却有 1 亿量级热值，供给明显不足",
    caution:
      "偏现实参照题材，AI 人脸的恐怖谷风险中等；建议先做 1-2 集小步试水再决定是否连载",
    craftNote: "权力结构与规矩感是核心，不是打架；用「谁能动谁」来制造压迫。",
    source: "DataEye 2026H1 报告（部数与热值口径不同，需谨慎对比）",
    confidence: "medium",
  },
  {
    id: "shenhao",
    label: "神豪",
    tier: "blue-ocean",
    rationale: "短剧数仅 1900-2500 部却有 1 亿量级热值，供需存在缺口",
    caution:
      "偏现实参照题材，AI 人脸的恐怖谷风险中等；且爽点依赖现代消费场景，画面容易穿帮",
    craftNote: "花钱要砸在「打脸的那一刻」，不要平铺炫富；金额要有具体对比物。",
    source: "DataEye 2026H1 报告（部数与热值口径不同，需谨慎对比）",
    confidence: "medium",
  },

  // ========== 红海慎入：供给与投放饱和 ==========
  {
    id: "nixi",
    label: "逆袭",
    tier: "red-ocean",
    rationale: "漫剧端已有 6648 部、占投放量 35%，是最拥挤的赛道",
    caution:
      "同质化最严重：同样的打脸结构已被反复消耗，没有强差异化设定很难被看见",
    craftNote:
      "逆袭路径必须反套路（别再用「三年后我回来了」）；打脸对象要有新鲜身份。",
    source: "DataEye 2026H1 报告（6648 部 / 投放占比 35%）",
    confidence: "high",
  },
  {
    id: "dashengzhu-chongsheng",
    label: "大女主重生复仇",
    tier: "red-ocean",
    rationale: "标签泛滥：剧名中「重生」词频达 1870 次，观众已产生标题疲劳",
    caution:
      "片名与开场若沿用常见重生套路，首 3 秒留存会被观众的「又是这个」预判吃掉",
    craftNote:
      "重生的信息优势要用在非常规地方（不只是提前避开渣男）；复仇要有代价与反噬。",
    source: "DataEye 2026H1 报告（剧名词频统计 1870 次）",
    confidence: "high",
  },

  // ========== 不建议：供需倒挂 ==========
  {
    id: "tianchong-xianyan",
    label: "甜宠 / 现言",
    tier: "not-advised",
    rationale: "漫剧供给量排第四，但播放量并不匹配 —— 典型的供需倒挂",
    caution: "供给已经过剩而需求未跟上；同时现代都市场景缺乏 AI 画风的奇观优势",
    craftNote:
      "甜要建立在具体的关系张力上（身份差 / 禁忌 / 误会），不要无冲突撒糖。",
    source: "DataEye 2026H1 报告（供给第四 / 播放量不匹配）",
    confidence: "medium",
  },
  {
    id: "bazong",
    label: "霸总",
    tier: "not-advised",
    rationale: "真人短剧的绝对主场，AI 漫剧在此无画面优势且人设高度同质",
    caution: "观众对霸总的视觉期待锚定在真人演员，漫剧版容易被直接对比并劝退",
    craftNote:
      "若坚持要做，霸总的权力必须作用在剧情上（能改变他人命运），不只是有钱。",
    source: "竞品拆解 + 真人短剧对比",
    confidence: "medium",
  },

  // ========== 避开：恐怖谷 + 正面对撞真人短剧 ==========
  {
    id: "dushi-richang",
    label: "都市日常 / 职场",
    tier: "avoid",
    rationale: "完全依赖现实参照，AI 画面既无奇观优势又放大人脸违和",
    caution:
      "恐怖谷效应在有现实参照时被显著放大（「模板脸」话题微博阅读 5200 万、曾上热搜 TOP4）；且正面对撞成熟真人短剧 —— 真人短剧总播放是 AI 漫剧的约 25 倍",
    craftNote:
      "若坚持要做，务必把场景推向非写实（强风格化画风），降低与真人的直接比较。",
    source: "微博舆情（5200 万阅读）+ 艾媒弃剧归因调研 + DataEye 大盘播放对比",
    confidence: "high",
  },
  {
    id: "jiating-lunli",
    label: "家庭伦理",
    tier: "avoid",
    rationale: "强现实参照 + 依赖微表情演技，是 AI 生成最吃亏的组合",
    caution:
      "情感张力主要靠面部微表情承载，而「配音情感不足」与「模板脸」正是近半数用户的弃剧归因",
    craftNote:
      "若坚持要做，把冲突外化成可见事件（摔门 / 搬走 / 分家），别指望靠表情演内心戏。",
    source: "艾媒咨询 AI 动漫用户弃剧归因调研（近半数用户）",
    confidence: "high",
  },

  // ========== 平台不要 ==========
  {
    id: "jieshuo",
    label: "解说漫剧",
    tier: "prohibited",
    rationale:
      "平台分账系数已从 5 下调至 1（2026-04-30 生效），平台明确不要这个品类",
    caution:
      "同样的有效观看时长，收益只剩原来的 1/5；平台规则层面的打压无法靠内容质量弥补",
    craftNote:
      "若只是想快速验证故事，建议改用正片形态做短集数试水，而不是做解说。",
    source: "抖音漫剧官方分账规则（2026-04-30 生效版）",
    confidence: "high",
  },
] as const;

/** id → 题材索引（模块加载时构建一次） */
const GENRE_BY_ID: ReadonlyMap<string, GenreOption> = new Map(
  GENRE_OPTIONS.map((g) => [g.id, g])
);

/** tier → 档位元信息索引 */
const TIER_BY_ID: ReadonlyMap<GenreTier, GenreTierMeta> = new Map(
  GENRE_TIERS.map((t) => [t.tier, t])
);

/**
 * 取题材条目。未知 id / 空值返回 null —— 题材是**可选**的，
 * 不设默认值（不猜用户意图，也不把空当成某个具体题材）。
 */
export function getGenreById(id?: string | null): GenreOption | null {
  if (!id) return null;
  return GENRE_BY_ID.get(id) ?? null;
}

/** 取档位元信息。未知档位返回 null（调用方按「无元信息」处理）。 */
export function getGenreTierMeta(
  tier?: GenreTier | null
): GenreTierMeta | null {
  if (!tier) return null;
  return TIER_BY_ID.get(tier) ?? null;
}

/** 按档位分组的题材列表（UI 分组渲染用；顺序同 GENRE_TIERS） */
export interface GenreTierGroup {
  meta: GenreTierMeta;
  options: readonly GenreOption[];
}

/**
 * 按档位分组（从注册表派生，单一真源）。
 * 空分组不输出，避免 UI 渲染出没有选项的标题。
 */
export const GENRE_TIER_GROUPS: readonly GenreTierGroup[] = GENRE_TIERS.map(
  (meta) => ({
    meta,
    options: GENRE_OPTIONS.filter((g) => g.tier === meta.tier),
  })
).filter((group) => group.options.length > 0);

/**
 * 题材的风险提示：仅在该题材带 caution 时返回，否则 null。
 *
 * UI 契约：有返回值即必须在选中后**同屏**展示（不是 tooltip），但**不阻断**提交 ——
 * 给信息让用户自己决定（沿用 lib/character-finalized.ts 的「不硬阻断」原则）。
 */
export interface GenreAdvisory {
  /** 风险严重度（取自档位 severity） */
  severity: GenreTierMeta["severity"];
  /** 档位标题（如「避开」「平台不要」） */
  tierLabel: string;
  /** 警告正文 */
  caution: string;
}

export function resolveGenreAdvisory(id?: string | null): GenreAdvisory | null {
  const genre = getGenreById(id);
  if (!genre?.caution) return null;
  const meta = getGenreTierMeta(genre.tier);
  if (!meta) return null;
  return {
    severity: meta.severity,
    tierLabel: meta.label,
    caution: genre.caution,
  };
}

/**
 * 构建注入 LLM 的题材上下文块（F3 的 prompt 侧产物）。
 *
 * 语义是**补充上下文**：告诉 LLM「本片是什么题材、这个题材该怎么写」，
 * 与 episode-structure.ts 的通用方法论规则**并列共存**，绝不替换它们。
 * 未知 id / 空值返回空串 —— 调用方拼接空串即等于不注入（零回归）。
 *
 * 允许传入自由文本题材（用户手填、不在矩阵内）：此时只注入题材名，不带创作要点，
 * 因为我们没有该题材的数据结论，编造要点会污染产出。
 */
export function buildGenreGuidanceBlock(id?: string | null): string {
  const genre = getGenreById(id);
  if (!genre) return "";
  return `【题材定位：${genre.label}】
本片题材为「${genre.label}」，全片设定、冲突与视觉奇观都必须服务于该题材的核心看点。
该题材创作要点：${genre.craftNote}`;
}

/**
 * 自由文本题材的轻量上下文块（题材不在矩阵内时用）。
 * 只声明题材名，不附加任何我们没有依据的创作要点。
 */
export function buildFreeformGenreBlock(genreText?: string | null): string {
  const trimmed = genreText?.trim();
  if (!trimmed) return "";
  return `【题材定位：${trimmed}】
本片题材为「${trimmed}」，全片设定、冲突与视觉奇观都必须服务于该题材的核心看点。`;
}

/**
 * 题材上下文块的统一入口：矩阵内走带创作要点的版本，矩阵外走自由文本版本。
 * 两条叙事管线（小说解析 / 短剧创作）都从此函数取块，避免各自判断。
 */
export function buildGenreContextBlock(genre?: string | null): string {
  const matched = buildGenreGuidanceBlock(genre);
  return matched || buildFreeformGenreBlock(genre);
}

/**
 * 连载结构提示（F4）—— 纯提示，不强制。
 *
 * 依据：抖音漫剧官方分账公式为
 *   `当月新增有效时长 × 时长单价 × 漫剧类型系数 × 版权系数`
 * 计价单位是「有效观看时长」而不是播放量，所以收入 ≈ 完播率 × 集数 × 单集时长。
 * 这解释了行业为什么普遍做 200-700 集连载，而不是做单集精品。
 */
export const SERIALIZATION_ADVICE = {
  /** 一句话结论（UI 展示） */
  headline: "连载比单集更划算：平台按「有效观看时长」分账，不按播放量",
  /** 展开说明（UI 折叠区 / 提示文案） */
  detail:
    "抖音漫剧分账 = 当月新增有效时长 × 时长单价 × 漫剧类型系数 × 版权系数。收入约等于「完播率 × 集数 × 单集时长」，所以同样的故事拆成连载、把完播率做高，比堆单集时长更有效。",
  /** 行业常见的 80-100 集连载分段结构 */
  phases: [
    {
      range: "1-10 集",
      role: "黄金窗口：决定能不能被推起来，钩子密度拉到最满",
    },
    { range: "11-30 集", role: "稳固期：建立长期追更习惯，逐步升级核心矛盾" },
    { range: "31-80 集", role: "收束期：回收伏笔、兑现爽点，保持完播率不塌" },
  ],
  source: "抖音漫剧官方分账规则（2026-04-30 生效版）+ 行业连载结构惯例",
  confidence: "high" as GenreConfidence,
} as const;

/**
 * 目标时长的连载提示：短于阈值不提示（本来就是单集试水），
 * 超过阈值才提醒「拆成连载更划算」。纯提示，返回 null 即不展示。
 *
 * 阈值取 180 秒：90-120 秒是单集常规区间，超过 3 分钟说明用户在往「长单集」走，
 * 这正是分账规则下最不划算的方向。
 */
const LONG_SINGLE_EPISODE_THRESHOLD_SEC = 180;

export function resolveSerializationHint(durationSec: number): string | null {
  if (!Number.isFinite(durationSec)) return null;
  if (durationSec <= LONG_SINGLE_EPISODE_THRESHOLD_SEC) return null;
  return `目标时长已超过 ${LONG_SINGLE_EPISODE_THRESHOLD_SEC} 秒。${SERIALIZATION_ADVICE.headline}——同样的内容量，拆成多集连载（用「新建系列」）通常比做成一集长片更划算。`;
}
