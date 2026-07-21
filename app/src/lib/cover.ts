/**
 * 平台竖屏封面（红果/抖音审核链条覆盖封面）——确定性合成的纯逻辑单一真源。
 *
 * 现状痛点：导出封面 / 项目卡缩略图直接复用「首张有图分镜」，既非高颜值主角、
 * 也无大字剧名，达不到平台「高吸引力 + 大字标题」的封面审核标准。本模块产出
 * 「已有图做底 + 中文大字标题排版」的封面合成参数（零 AI 成本），实际渲染由
 * services/cover.ts 走 ffmpeg 单帧 + ASS 烧字（与片头卡同一条文字管道）。
 *
 * 本文件只含纯函数（无 IO / 无 ffmpeg / 不依赖 services）：
 * - resolveCoverText：标题 / 副题的缺省解析 + 主标题两行拆分策略；
 * - resolveCoverSource：底图白名单校验 + 缺省解析（主角定妆图优先）；
 * - buildCoverAss：封面 ASS 字幕文本组装（复用 CARD_STYLE / 字体白名单单一真源）。
 *
 * 字体 / 字号倍率 / 配色全部读 lib/title-cards.ts#CARD_STYLE 与
 * lib/subtitle-fonts.ts，与片头卡「剧名大字」一脉相承，不新起字体或数值。
 */

import { CARD_STYLE } from "@/lib/title-cards";
import { resolveSubtitleFont, TITLE_FONT_ID } from "@/lib/subtitle-fonts";
import { resolveSubtitleFontPx } from "@/types/export-style";

/** 平台封面固定规格：竖屏 1080×1920（与项目 aspectRatio 无关，平台封面统一竖屏） */
export const COVER_WIDTH = 1080;
export const COVER_HEIGHT = 1920;

/** 剧名主字最大长度（超出裁断，封面是标语不是段落） */
const TITLE_MAX_LEN = 20;
/** 副题最大长度 */
const SUBTITLE_MAX_LEN = 16;
/** 主标题单行最大字数（超过则拆到第二行，≤2 行） */
const TITLE_MAX_CHARS_PER_LINE = 7;

/** 解析后的封面文字：主标题（1-2 行）+ 可选副题 */
export interface ResolvedCoverText {
  /** 剧名主字（已裁长度，含 \n 折行的两行策略结果，最多两行） */
  title: string;
  /** 副题（系列集数「第 N 集」或用户自定义）；null = 不显示副题 */
  subtitle: string | null;
}

/** resolveCoverText 入参 */
export interface ResolveCoverTextInput {
  /** 项目名（title 缺省来源） */
  projectName: string;
  /** 集数（系列项目有值 → 副题缺省「第 N 集」） */
  episodeNumber?: number | null;
  /** 用户自定义主标题（优先于项目名） */
  title?: string | null;
  /** 用户自定义副题（优先于集数缺省） */
  subtitle?: string | null;
}

/** 文本清洗：合并空白、去首尾、裁到上限（封面文字是标语） */
function sanitize(text: string, maxLen: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * 把主标题按每行最大字数拆成最多两行（超两行内容截断在第二行末）。
 * 中文封面剧名通常 2-8 字，超长（如带副标题的长剧名）折两行更稳，避免
 * 单行大字溢出画面。已在单行内的短标题原样返回（无 \n）。
 */
function splitTitleToTwoLines(title: string): string {
  const chars = Array.from(title);
  if (chars.length <= TITLE_MAX_CHARS_PER_LINE) return title;
  const first = chars.slice(0, TITLE_MAX_CHARS_PER_LINE).join("");
  const second = chars
    .slice(TITLE_MAX_CHARS_PER_LINE, TITLE_MAX_CHARS_PER_LINE * 2)
    .join("");
  return `${first}\n${second}`;
}

/**
 * 解析封面文字（纯函数）。
 *
 * 标题：用户自定义 title 优先 → 缺省用项目名 → 再缺省「无题」；裁到 TITLE_MAX_LEN
 * 后按两行策略拆分（≤2 行）。
 * 副题：用户自定义 subtitle 优先 → 缺省时系列集数给「第 N 集」→ 否则 null。
 */
export function resolveCoverText(
  input: ResolveCoverTextInput
): ResolvedCoverText {
  const rawTitle = input.title?.trim()
    ? input.title
    : input.projectName?.trim()
      ? input.projectName
      : "无题";
  const title = splitTitleToTwoLines(sanitize(rawTitle, TITLE_MAX_LEN));

  let subtitle: string | null = null;
  if (input.subtitle?.trim()) {
    subtitle = sanitize(input.subtitle, SUBTITLE_MAX_LEN);
  } else if (
    typeof input.episodeNumber === "number" &&
    Number.isFinite(input.episodeNumber) &&
    input.episodeNumber > 0
  ) {
    subtitle = `第 ${Math.round(input.episodeNumber)} 集`;
  }

  return { title, subtitle };
}

/** resolveCoverSource 入参 */
export interface ResolveCoverSourceInput {
  /** 请求指定的底图 URL（必须命中白名单才接受） */
  requestedUrl?: string | null;
  /** 本项目关联角色的定妆图 URL 集合（Character.canonicalImageUrl 非空项） */
  characterCanonicalUrls: string[];
  /** 本项目分镜的图片 URL 集合（Scene.imageUrl 非空项，按分镜顺序） */
  sceneImageUrls: string[];
}

/**
 * 解析封面底图（纯函数，防 SSRF 白名单）。
 *
 * 白名单集合 = 本项目分镜 imageUrl ∪ 本项目关联角色定妆图 canonicalImageUrl。
 * - requestedUrl 非空：必须命中白名单才接受，命中外 → 返回 null（调用方 400）；
 * - requestedUrl 缺省：自动解析——主角定妆图（第一张 canonicalImageUrl）优先，
 *   否则首张有图分镜，都无 → null（无底图无法合成封面）。
 *
 * 不接受任意 URL，杜绝「用户传外网 URL 让服务端下载」的 SSRF 面。
 */
export function resolveCoverSource(
  input: ResolveCoverSourceInput
): string | null {
  const whitelist = new Set<string>([
    ...input.characterCanonicalUrls.filter((u) => !!u),
    ...input.sceneImageUrls.filter((u) => !!u),
  ]);

  if (input.requestedUrl != null && input.requestedUrl !== "") {
    return whitelist.has(input.requestedUrl) ? input.requestedUrl : null;
  }

  // 缺省：主角定妆图优先，否则首张有图分镜
  const canonical = input.characterCanonicalUrls.find((u) => !!u);
  if (canonical) return canonical;
  const firstScene = input.sceneImageUrls.find((u) => !!u);
  return firstScene ?? null;
}

/**
 * 转义 ASS 事件文本：大括号是标签起止符需转义，换行转 \N（与 video-synthesis 同规则）。
 */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/**
 * #RRGGBB → ASS 颜色 &H00BBGGRR（BGR 顺序，alpha 00=不透明；与 video-synthesis 同规则）。
 */
function hexToAssColor(hex: string): string {
  const cleaned = hex.replace(/^#/, "");
  const r = cleaned.substring(0, 2);
  const g = cleaned.substring(2, 4);
  const b = cleaned.substring(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

/**
 * 构建封面 ASS 全文（纯函数，供 services/cover 写临时文件后交 ffmpeg subtitles 烧字）。
 *
 * 排版：标题主字（得意黑巨字）+ 副题排在画面下三分之一（避开人物脸部，符合平台
 * 封面「大字在下」惯例）；\an5 中心锚点 + \pos 居中偏排，粗黑描边保证任意底图可读。
 * 字号 / 字体 / 配色全部读 CARD_STYLE + 字体白名单单一真源（与片头卡剧名同源）。
 *
 * 基准正文字号取 24（与 SubtitleStyle 默认一致），封面标题 = 24 × CARD_STYLE.titleScale
 * 经 resolveSubtitleFontPx 按 1920 高换算；两行标题时字号不额外缩（拆行已控行数）。
 *
 * @param resolved 解析后的封面文字（title 可含 \n 两行）
 * @returns 完整 ASS 文件文本
 */
export function buildCoverAss(resolved: ResolvedCoverText): string {
  const width = COVER_WIDTH;
  const height = COVER_HEIGHT;
  // 基准正文字号（与 DEFAULT_SUBTITLE_STYLE.fontSize 对齐），封面按 CARD_STYLE 倍率放大
  const baseFontSize = 24;
  const titleSize = resolveSubtitleFontPx(
    baseFontSize * CARD_STYLE.titleScale,
    height
  );
  const subSize = resolveSubtitleFontPx(
    baseFontSize * CARD_STYLE.subScale,
    height
  );
  // 标题字体 = 得意黑（显示型斜体，与片头卡剧名一致）
  const titleFont = resolveSubtitleFont(TITLE_FONT_ID).assFontName;
  const fill = hexToAssColor(CARD_STYLE.fillColor);
  const outline = hexToAssColor(CARD_STYLE.outlineColor);
  // 封面大字描边加粗（基准描边 2px × outlineScale，最小 3 保证在真人脸底图上可读）
  const coverOutline = Math.max(3, Math.round(2 * CARD_STYLE.outlineScale));

  const cx = Math.round(width * 0.5);
  // 标题排在画面 72% 高（下三分之一偏上），副题在 84% 高（标题之下）
  const titleY = Math.round(height * 0.72);
  const subY = Math.round(height * 0.84);

  const events: string[] = [];
  // 封面是静帧（-frames:v 1），时间窗给足 10s 覆盖单帧输出即可
  const start = "0:00:00.00";
  const end = "0:00:10.00";

  events.push(
    `Dialogue: 0,${start},${end},CoverTitle,,0,0,0,,{\\an5\\pos(${cx},${titleY})}${escapeAssText(resolved.title)}`
  );
  if (resolved.subtitle) {
    events.push(
      `Dialogue: 0,${start},${end},CoverSub,,0,0,0,,{\\an5\\pos(${cx},${subY})}${escapeAssText(resolved.subtitle)}`
    );
  }

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // 封面剧名巨字：得意黑、白字粗黑描边、粗体（Bold=-1）
    `Style: CoverTitle,${titleFont},${titleSize},${fill},&H000000FF,${outline},&H80000000,-1,0,0,0,100,100,0,0,1,${coverOutline},0,5,40,40,40,1`,
    // 封面副题：得意黑、白字粗描边、常规
    `Style: CoverSub,${titleFont},${subSize},${fill},&H000000FF,${outline},&H80000000,0,0,0,0,100,100,0,0,1,${coverOutline},0,5,40,40,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "",
  ].join("\n");

  return `${header}${events.join("\n")}\n`;
}
