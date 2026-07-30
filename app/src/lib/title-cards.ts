/**
 * 片头标题卡 / 片尾下集钩子卡（批6 成片包装）——预览端与导出端的单一真源。
 *
 * 漫剧结构标配：片头 ~2s 标题卡（剧名+集数）建立品牌感，片尾 ~2.5s 钩子卡
 * （下集悬念文案+追更贴字）承接追更转化——脚本层早已设计钩子（endingHook），
 * 本模块把它变成成片视觉。
 *
 * 实现路线（零新 ffmpeg 滤镜）：卡片作为「普通图片分镜」走既有合成管线
 * （底图 = 首镜图/末镜图，自带 Ken Burns 缓推），卡片文字走 ASS 字幕层的
 * 专用 Title/Hook 样式（得意黑大字），预览端按同一 CardSpec 渲染 DOM 覆盖层。
 *
 * 配置存于 Project.generationParams.titleCards（JSON 白名单位，零 schema 变更）；
 * 缺省契约：系列项目默认双卡开启，非系列默认关闭（resolveTitleCardsEnabled）。
 *
 * ⚠️ 导出端注入卡片后 options.transitions 按索引对齐会整体位移，
 * 由导出路由负责补齐首/尾转场项（见 export/route.ts）。
 */

/** 片头/片尾卡开关配置（存 generationParams.titleCards） */
export interface TitleCardsConfig {
  /** 片头标题卡；缺省时按 resolveTitleCardsEnabled 契约解析 */
  title?: boolean;
  /** 片尾钩子卡；缺省时按 resolveTitleCardsEnabled 契约解析 */
  end?: boolean;
}

/** 卡片文字行角色（决定两端渲染样式：字号/字体/颜色档位） */
export type CardLineRole = "title" | "sub" | "hook" | "cta";

/** 卡片单行文字 */
export interface CardLine {
  text: string;
  role: CardLineRole;
}

/** 一张卡片的完整描述（两端共同消费） */
export interface CardSpec {
  kind: "title" | "end";
  /** 底图 URL（首镜图/末镜图）；null = 纯黑底 */
  imageUrl: string | null;
  /** 卡片时长（秒） */
  durationSec: number;
  /** 文字行（自上而下渲染） */
  lines: CardLine[];
}

/** 片头卡时长（秒）——漫剧标配 1.5-2s，取上限保证可读 */
export const TITLE_CARD_SEC = 2;
/** 片尾卡时长（秒）——钩子文案需要更长停留 */
export const END_CARD_SEC = 2.5;

/**
 * 卡片 ASS 样式规格（批6 片头/片尾卡 + 平台封面共用的单一真源）。
 *
 * 字号以「正文字号（SubtitleStyle.fontSize，基于 1080 基准高）」为基准的倍率表达，
 * 不硬编码绝对像素——导出端经 resolveSubtitleFontPx 按实际画面高线性换算，
 * 跨分辨率视觉占比一致。颜色 / 描边倍率同样集中于此，改数值只动这一处。
 *
 * 消费方：
 * - video-synthesis.buildAssHeader（片头/片尾卡的 CardTitle/CardSub/CardHook/CardCta 样式）
 * - services/cover（平台封面的剧名主字 / 副题字号与颜色）
 * 二者读同一份倍率，保证「封面剧名大字」与「片头卡剧名大字」字形字号一脉相承。
 */
export const CARD_STYLE = {
  /** 剧名主字：正文字号 × 2.2（巨字冲击力） */
  titleScale: 2.2,
  /** 副标题（集数）：正文字号 × 1.1 */
  subScale: 1.1,
  /** 片尾钩子悬念：正文字号 × 1.6 */
  hookScale: 1.6,
  /** 片尾追更贴字：正文字号 × 0.95 */
  ctaScale: 0.95,
  /** 主字/副字通用白（粗黑描边压得住任意底图） */
  fillColor: "#FFFFFF",
  /** 描边黑 */
  outlineColor: "#000000",
  /** 追更贴字暖金强调色（与金句花字同色系） */
  ctaColor: "#FFD24D",
  /** 描边相对正文描边宽的放大倍率（大字需更粗描边保可读，最小 2px 由消费端钳制） */
  outlineScale: 2,
} as const;

/** 卡片合成分镜的保留 id（真实分镜 id 为 cuid，双下划线前缀不会冲突） */
export const TITLE_CARD_SCENE_ID = "__title-card__";
export const END_CARD_SCENE_ID = "__end-card__";

/** 判断某分镜 id 是否为卡片合成分镜 */
export function isCardSceneId(sceneId: string): boolean {
  return sceneId === TITLE_CARD_SCENE_ID || sceneId === END_CARD_SCENE_ID;
}

/** 文本清洗：去换行/裁剪长度（卡片是标语不是段落） */
function sanitizeCardText(text: string, maxLen: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * 解析卡片开关的最终生效值。
 * 缺省契约：系列项目（isSeries=true）双卡默认开——片头建品牌、片尾钩追更；
 * 非系列单片默认关（用户在导出弹窗显式开启）。已存配置逐项优先。
 */
export function resolveTitleCardsEnabled(
  config: TitleCardsConfig | null | undefined,
  isSeries: boolean
): { title: boolean; end: boolean } {
  return {
    title: config?.title ?? isSeries,
    end: config?.end ?? isSeries,
  };
}

/** buildTitleCards 入参 */
export interface BuildTitleCardsInput {
  /** 项目标题（剧名） */
  projectTitle: string;
  /** 集数（系列项目有值 → 片头卡显示「第 N 集」） */
  episodeNumber?: number | null;
  /** 片尾钩子文案（脚本 endingHook / 圣经；缺省用通用追更文案） */
  hookText?: string | null;
  /** 片头卡底图（通常取首镜图） */
  coverImageUrl?: string | null;
  /** 片尾卡底图（通常取末镜图） */
  endImageUrl?: string | null;
  /** 卡片开关配置（generationParams.titleCards） */
  config?: TitleCardsConfig | null;
  /** 是否系列项目（决定缺省开关） */
  isSeries: boolean;
}

/**
 * 构建片头/片尾卡描述（纯函数，两端共用）。
 * 返回 null 项表示该卡未启用；调用方按 CardSpec 注入合成分镜/预览时间轴。
 */
export function buildTitleCards(input: BuildTitleCardsInput): {
  intro: CardSpec | null;
  outro: CardSpec | null;
} {
  const enabled = resolveTitleCardsEnabled(input.config, input.isSeries);

  let intro: CardSpec | null = null;
  if (enabled.title) {
    const lines: CardLine[] = [
      {
        text: sanitizeCardText(input.projectTitle || "无题", 24),
        role: "title",
      },
    ];
    if (
      typeof input.episodeNumber === "number" &&
      Number.isFinite(input.episodeNumber) &&
      input.episodeNumber > 0
    ) {
      lines.push({
        text: `第 ${Math.round(input.episodeNumber)} 集`,
        role: "sub",
      });
    }
    intro = {
      kind: "title",
      imageUrl: input.coverImageUrl ?? null,
      durationSec: TITLE_CARD_SEC,
      lines,
    };
  }

  let outro: CardSpec | null = null;
  if (enabled.end) {
    const hook = sanitizeCardText(input.hookText ?? "", 40);
    outro = {
      kind: "end",
      imageUrl: input.endImageUrl ?? null,
      durationSec: END_CARD_SEC,
      lines: [
        { text: hook || "剧情正酣，好戏在后头", role: "hook" },
        { text: "关注追更 · 下集更精彩", role: "cta" },
      ],
    };
  }

  return { intro, outro };
}

/**
 * 按「分镜保留掩码」重建转场数组（导出端滤掉无媒体分镜后的索引对齐修复）。
 *
 * 背景：transitions 是索引对齐数组——第 k 项 = 第 k 与 k+1 个分镜之间的 gap。
 * 编辑器/预览端按【全量分镜】索引维护它，导出端却先滤掉无图无视频的分镜再合成，
 * 长度与语义都会整体错位（用户配在第 5 镜后的转场跑到第 3 镜后）。
 *
 * gap 合并语义：被滤掉的第 k 镜，其「入边 gap(k-1)」与「出边 gap(k)」在保留序列里
 * 合并成同一条边，此时【保留前一个 gap 的配置、丢弃被删镜自身出边的配置】——
 * 因为前一个 gap 的「上游镜」在保留序列里没变，用户对它的配置仍然成立；而被删镜的
 * 出边配置描述的是一个已不存在的镜的离场，语义已失效。
 *
 * 首镜被滤掉时其出边 gap(0) 直接丢弃（前面没有可保留的 gap）。
 *
 * 入参 transitions 允许短于「全量镜数 - 1」（用户只配了前几个 gap）。这类缺位
 * 在输出里以 undefined 占位保留索引对齐，合成端 `options.transitions?.[k]` 本就
 * 按缺项回落默认转场，语义与修复前一致。
 *
 * @param transitions 全量分镜索引下的转场数组（长度语义 = 全量镜数 - 1，允许短缺）
 * @param keepMask 与全量分镜等长的保留掩码（true = 该镜进入导出）
 * @returns 保留序列索引下的转场数组（长度 = 保留镜数 - 1）
 */
export function remapTransitionsByKeepMask<T>(
  transitions: readonly (T | undefined)[],
  keepMask: readonly boolean[]
): (T | undefined)[] {
  const out: (T | undefined)[] = [];
  // pendingGap：上一个「保留镜」的出边配置。遇到被滤掉的镜时不覆盖它
  // （= 保留前一个 gap 的配置、丢弃被删镜的出边）。
  let pendingGap: T | undefined;
  let hasPending = false;

  for (let i = 0; i < keepMask.length; i += 1) {
    if (!keepMask[i]) continue; // 被滤掉的镜：其出边 transitions[i] 丢弃，pendingGap 不变
    // 该镜保留：若已攒下一条 gap 配置，说明它与「上一个保留镜」之间成边，落盘。
    if (hasPending) out.push(pendingGap);
    // 本镜的出边成为下一条待定 gap（末镜的出边最终不会被落盘）。
    pendingGap = transitions[i];
    hasPending = true;
  }

  // 循环结束时的 pendingGap 是「最后一个保留镜的出边」，保留序列里它后面没有镜，丢弃。
  return out;
}
