/**
 * AI 生成内容提示标识（合规）——导出端与预览端的单一真源。
 *
 * ── 法规依据 ──
 * 《微短剧管理办法》（国家广播电视总局令第 16 号，2026-09-01 施行）
 *   第三十四条：「使用人工智能技术生成、制作的微短剧，制作机构和播出单位应当
 *   在每集明显位置添加提示标识。」
 *   第二十七条：片头应在明显位置标注剧名、许可证号、批准文件编号、节目编号
 *   （片头信息位在 lib/title-cards.ts 的 CardSpec 里落地，不在本文件）。
 * 来源：https://www.nrta.gov.cn/art/2026/7/31/art_113_73785.html
 *
 * ⚠️ 关于量化参数的重要说明：
 * 法规原文仅要求「每集明显位置添加提示标识」，**未规定**任何量化参数——
 * 字号占比、停留秒数、标识图形样式、具体角位均无条文依据。本文件下方所有
 * 数值（字号倍率 / 边距 / 透明度 / 时长模式）都是**我们自选的合理默认值**，
 * 全部可由用户在导出弹窗覆盖。请勿把任何数值当作「合规阈值」对外陈述，
 * 也勿据此给用户「已满足 X 秒/X 字号要求」的承诺。
 *
 * 默认开启：这是法定强制要求而非可选增强功能。允许关闭仅为覆盖「不投国内
 * 持证平台」的用途（如海外发布 / 内部样片），关闭后的合规责任归使用者。
 *
 * ── 双端同源契约（预览铁律）──
 * 导出端（services/video-synthesis/ass/builder.ts 的 buildDisclosureEvents
 * + AiDisclosure ASS 样式）与预览端（components/preview-player/
 * disclosure-overlay.tsx 的 DOM 覆盖层）读本文件同一份常量：
 * 字号倍率、边距比例、透明度、时间窗判据全部来自此处，改数值只动这一处。
 * 同 impact-effect-params.ts / title-cards.ts CARD_STYLE 的模式。
 */

/** 标识位置（画面九宫格的四角 + 上下居中，均在安全区内） */
export const DISCLOSURE_POSITIONS = [
  "tl",
  "tr",
  "bl",
  "br",
  "top",
  "bottom",
] as const;

/** 标识位置类型 */
export type DisclosurePosition = (typeof DISCLOSURE_POSITIONS)[number];

/**
 * 显示时长模式：
 * - "always"：全集全程显示（默认，最稳妥地满足「明显位置」要求）；
 * - "head"：仅片头前 headSec 秒显示（用户若嫌全程压画面可选）。
 */
export const DISCLOSURE_MODES = ["always", "head"] as const;

/** 显示时长模式类型 */
export type DisclosureMode = (typeof DISCLOSURE_MODES)[number];

/** 文案最大长度（防超长文案压画面；标识是短提示不是段落） */
export const DISCLOSURE_TEXT_MAX_LEN = 24;

/**
 * AI 标识配置（存 Project.generationParams.aiDisclosure，零 schema 变更）。
 *
 * 所有字段可选：缺省时由 resolveAiDisclosure 填入 DEFAULT_AI_DISCLOSURE 的值。
 * 注意 enabled 的缺省语义是 **true**（法定要求默认开），与项目里其他
 * 「缺省关」的可选增强功能（水印 / 调色）相反——见 resolveAiDisclosure。
 */
export interface AiDisclosure {
  /** 是否叠加标识；缺省视为 true（法定要求默认开启） */
  enabled?: boolean;
  /** 提示文案；缺省 DEFAULT_AI_DISCLOSURE.text */
  text?: string;
  /** 标识位置；缺省 DEFAULT_AI_DISCLOSURE.position */
  position?: DisclosurePosition;
  /** 字号倍率（相对正文字幕字号）；缺省 DEFAULT_AI_DISCLOSURE.fontScale */
  fontScale?: number;
  /** 不透明度 0-1；缺省 DEFAULT_AI_DISCLOSURE.opacity */
  opacity?: number;
  /** 显示时长模式；缺省 DEFAULT_AI_DISCLOSURE.mode */
  mode?: DisclosureMode;
  /** mode="head" 时的片头显示秒数；缺省 DEFAULT_AI_DISCLOSURE.headSec */
  headSec?: number;
}

/** 已解析的 AI 标识配置（全字段必填，两端直接消费） */
export interface ResolvedAiDisclosure {
  enabled: boolean;
  text: string;
  position: DisclosurePosition;
  fontScale: number;
  opacity: number;
  mode: DisclosureMode;
  headSec: number;
}

/**
 * 默认值（全部为我们自选的合理默认，**非**法规量化要求，见文件头说明）。
 *
 * 取值理由（工程判断，可被用户覆盖）：
 * - text「本片由 AI 生成」：直白陈述生成事实，7 字在竖屏一行可读。
 * - position "tr" 右上角：避开底部字幕区（字幕默认 bottom）与左上角常见台标位，
 *   三者互不遮挡。
 * - fontScale 0.62：小于正文字幕，起到提示作用而不抢戏；过小则不「明显」。
 * - opacity 0.85：接近实心保证可辨识，略透以免过度压画面。
 * - mode "always" 全程显示：「每集明显位置」用全程显示最不易出错，
 *   也省去「多少秒才够」这种法规未规定的判断。
 * - headSec 5：仅 mode="head" 时生效的片头停留秒数。
 */
export const DEFAULT_AI_DISCLOSURE: ResolvedAiDisclosure = {
  enabled: true,
  text: "本片由 AI 生成",
  position: "tr",
  fontScale: 0.62,
  opacity: 0.85,
  mode: "always",
  headSec: 5,
};

/**
 * 标识距画面边缘的安全边距，以画面【宽】的比例表达（两端同源）。
 *
 * 用统一比例而非绝对像素：跨 480p/720p/1080p 与 9:16/16:9/1:1 视觉占比一致。
 * 0.04 ≈ 1080 宽下 43px，落在各平台安全区内（非法规要求，工程取值）。
 */
export const DISCLOSURE_MARGIN_RATIO = 0.04;

/** 文案可用的字号倍率区间（下限保可读、上限防压画面；非法规要求） */
export const DISCLOSURE_FONT_SCALE_MIN = 0.4;
export const DISCLOSURE_FONT_SCALE_MAX = 1.5;

/** mode="head" 时片头显示秒数的可选区间（非法规要求） */
export const DISCLOSURE_HEAD_SEC_MIN = 1;
export const DISCLOSURE_HEAD_SEC_MAX = 60;

/** 数值夹取（与 generation-params-normalize 的 clampNumber 同语义，此处自带避免跨层依赖） */
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** 文案清洗：折叠空白、裁剪长度（同 title-cards 的 sanitizeCardText 思路） */
function sanitizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, DISCLOSURE_TEXT_MAX_LEN);
}

/**
 * 解析 AI 标识的最终生效配置（纯函数，导出端 / 预览端 / 审片报告共用）。
 *
 * 缺省契约（与项目里其他可选功能相反，务必注意）：
 *   config 整体缺省（老项目无此字段）→ **启用**默认标识；
 *   config.enabled 缺省 → **true**。
 * 理由：第三十四条是强制要求，「没配置过」必须落在「已加标识」一侧，
 * 否则存量项目会静默导出成无标识成片。显式 enabled:false 才关闭。
 *
 * 非法值一律回落默认而非报错：标识是合规兜底，绝不能因一个坏字段导出成无标识片。
 *
 * @param config generationParams.aiDisclosure（可能为任意历史形态）
 * @returns 全字段已填充并夹取到合法范围的配置
 */
export function resolveAiDisclosure(
  config: AiDisclosure | null | undefined
): ResolvedAiDisclosure {
  if (!config) return { ...DEFAULT_AI_DISCLOSURE };

  const text =
    typeof config.text === "string" && sanitizeText(config.text)
      ? sanitizeText(config.text)
      : DEFAULT_AI_DISCLOSURE.text;

  const position =
    typeof config.position === "string" &&
    (DISCLOSURE_POSITIONS as readonly string[]).includes(config.position)
      ? config.position
      : DEFAULT_AI_DISCLOSURE.position;

  const mode =
    typeof config.mode === "string" &&
    (DISCLOSURE_MODES as readonly string[]).includes(config.mode)
      ? config.mode
      : DEFAULT_AI_DISCLOSURE.mode;

  return {
    // 缺省即开启（法定要求），仅显式 false 关闭
    enabled: config.enabled !== false,
    text,
    position,
    fontScale:
      typeof config.fontScale === "number"
        ? clamp(
            config.fontScale,
            DISCLOSURE_FONT_SCALE_MIN,
            DISCLOSURE_FONT_SCALE_MAX
          )
        : DEFAULT_AI_DISCLOSURE.fontScale,
    opacity:
      typeof config.opacity === "number"
        ? clamp(config.opacity, 0, 1)
        : DEFAULT_AI_DISCLOSURE.opacity,
    mode,
    headSec:
      typeof config.headSec === "number"
        ? clamp(
            config.headSec,
            DISCLOSURE_HEAD_SEC_MIN,
            DISCLOSURE_HEAD_SEC_MAX
          )
        : DEFAULT_AI_DISCLOSURE.headSec,
  };
}

/**
 * 标识在成片时间轴上的显示时间窗（秒）。
 *
 * - mode="always"：整片 [0, totalSec]；
 * - mode="head"：[0, min(headSec, totalSec)]。
 * 返回 null = 不显示（未启用 / 总时长非正）。导出端据此发 ASS 事件时间，
 * 预览端据此判断当前播放时刻是否该渲染覆盖层——两端同一判据。
 *
 * @param resolved 已解析配置
 * @param totalSec 成片总时长（秒）
 */
export function disclosureTimeWindow(
  resolved: ResolvedAiDisclosure,
  totalSec: number
): { start: number; end: number } | null {
  if (!resolved.enabled) return null;
  if (!Number.isFinite(totalSec) || totalSec <= 0) return null;
  const end =
    resolved.mode === "head" ? Math.min(resolved.headSec, totalSec) : totalSec;
  if (end <= 0) return null;
  return { start: 0, end };
}

/**
 * 标识在某时刻是否可见（预览端逐帧判据；与导出端 ASS 事件时间窗同源）。
 *
 * @param resolved 已解析配置
 * @param t        当前播放时刻（秒，成片轴）
 * @param totalSec 成片总时长（秒）
 */
export function isDisclosureVisibleAt(
  resolved: ResolvedAiDisclosure,
  t: number,
  totalSec: number
): boolean {
  const win = disclosureTimeWindow(resolved, totalSec);
  if (!win) return false;
  return t >= win.start && t < win.end;
}

/**
 * 标识锚点的归一化坐标（0-1）+ ASS 对齐码，两端同源。
 *
 * 返回值语义：
 * - x/y 为【锚点】归一化坐标（非中心点）：与 align 配合确定贴边方向，
 *   如 align="tr" 时 (x,y) 是文本块的右上角。
 * - align 直接映射 ASS \an 对齐码（1-9 九宫格），预览端据同一语义选
 *   CSS 的 left/right/top/bottom + transform。
 *
 * 边距统一用 DISCLOSURE_MARGIN_RATIO × 画面宽（横向），纵向按同一像素量
 * 换算为高度比例（由调用方用实际宽高完成，见 disclosureAssPos）。
 */
export function disclosureAnchor(position: DisclosurePosition): {
  /** ASS \an 对齐码（数字九宫格：7=左上 8=中上 9=右上 1=左下 2=中下 3=右下） */
  an: number;
  /** 横向贴边：left/right/center */
  hAlign: "left" | "center" | "right";
  /** 纵向贴边：top/bottom */
  vAlign: "top" | "bottom";
} {
  switch (position) {
    case "tl":
      return { an: 7, hAlign: "left", vAlign: "top" };
    case "tr":
      return { an: 9, hAlign: "right", vAlign: "top" };
    case "bl":
      return { an: 1, hAlign: "left", vAlign: "bottom" };
    case "br":
      return { an: 3, hAlign: "right", vAlign: "bottom" };
    case "top":
      return { an: 8, hAlign: "center", vAlign: "top" };
    case "bottom":
    default:
      return { an: 2, hAlign: "center", vAlign: "bottom" };
  }
}

/**
 * 计算 ASS \pos 的像素锚点坐标（导出端用；预览端用 disclosureAnchor + CSS 百分比）。
 *
 * 边距：横向 = 纵向 = DISCLOSURE_MARGIN_RATIO × width（同一像素量，视觉等距）。
 *
 * @param position 标识位置
 * @param width    成片画面宽（px）
 * @param height   成片画面高（px）
 */
export function disclosureAssPos(
  position: DisclosurePosition,
  width: number,
  height: number
): { x: number; y: number; an: number } {
  const { an, hAlign, vAlign } = disclosureAnchor(position);
  const margin = Math.round(width * DISCLOSURE_MARGIN_RATIO);
  const x =
    hAlign === "left"
      ? margin
      : hAlign === "right"
        ? width - margin
        : Math.round(width / 2);
  const y = vAlign === "top" ? margin : height - margin;
  return { x, y, an };
}
