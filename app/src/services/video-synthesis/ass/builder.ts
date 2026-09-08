/**
 * 视频合成 —— ASS 字幕构建器（纯函数）
 *
 * 从 services/video-synthesis.ts 原样提取（零行为变更）：ASS 文件头 / 卡片事件 /
 * 入场动效标签 / 事件正文 / 折行 / 时间与颜色格式化。全部为纯字符串构建，
 * 不触碰进程与文件系统（写盘由 video-synthesis.ts 的 generateSubtitleFile 负责）。
 */

import type { SubtitleStyle, SubtitleAnimation } from "@/types/export-style";
import { resolveSubtitleFontPx, EMPHASIS_STYLE } from "@/types/export-style";
// 字体白名单（批6）：字幕/花字/卡片字体两端单一真源，摆脱 Arial 硬编码。
import { resolveSubtitleFont, TITLE_FONT_ID } from "@/lib/subtitle-fonts";
// 片头/片尾卡（批6）：卡片文字行角色 → 卡片字幕样式映射；
// CARD_STYLE 为卡片/封面共用的字号倍率与配色单一真源。
import { CARD_STYLE, type CardLine } from "@/lib/title-cards";
// 逐句字幕切分共享的视觉宽度基准 + 动效时序常量（与预览端同源）。
import {
  charWidth,
  typewriterDelays,
  SUBTITLE_ANIM,
} from "@/lib/subtitle-segments";

/** 卡片文字行角色 → ASS Style 名映射（片头/片尾卡，批6） */
const CARD_ROLE_TO_STYLE: Record<CardLine["role"], string> = {
  title: "CardTitle",
  sub: "CardSub",
  hook: "CardHook",
  cta: "CardCta",
};

/**
 * 构建单张卡片（片头/片尾）的 ASS 字幕事件——整卡时长内一次性显示居中偏排文字。
 *
 * 卡片分镜是普通图片分镜（底图自带 Ken Burns 缓推），文字全部走字幕层：
 *   - 每行一条 Dialogue，Style 按 role 映射（title→CardTitle 等）；
 *   - 时间窗 = 整卡时长（cardStart ~ cardStart+cardDuration）；
 *   - 位置 \an5\pos 居中偏排：title/hook 在画面高 45% 处（偏上，视觉重心），
 *     sub/cta 在 58% 处（title 之下），x 恒居中；
 *   - 入场用 \fad(300,200) 柔和淡入淡出。
 *
 * @param card         卡片描述（kind + lines）
 * @param cardStart    卡片在成片时间轴上的起始秒
 * @param cardDuration 卡片时长（秒）
 * @param width,height 成片画面宽高（\pos 像素换算）
 * @returns Dialogue 事件字符串数组（每行一条）
 */
export function buildCardEvents(
  card: { kind: "title" | "end"; lines: CardLine[] },
  cardStart: number,
  cardDuration: number,
  width: number,
  height: number
): string[] {
  const events: string[] = [];
  const start = formatAssTime(cardStart);
  const end = formatAssTime(cardStart + cardDuration);
  const cx = Math.round(width * 0.5);
  // 上排（title/hook）在 45% 高，下排（sub/cta）在 58% 高——上下分层不重叠
  const topY = Math.round(height * 0.45);
  const bottomY = Math.round(height * 0.58);

  for (const line of card.lines) {
    const styleName = CARD_ROLE_TO_STYLE[line.role];
    const py = line.role === "title" || line.role === "hook" ? topY : bottomY;
    // \an5 中心锚点 + \pos 居中偏排 + \fad 柔和进出；文本转义防注入
    const text = `{\\an5\\pos(${cx},${py})\\fad(300,200)}${escapeAssText(line.text)}`;
    events.push(`Dialogue: 0,${start},${end},${styleName},,0,0,0,,${text}`);
  }
  return events;
}

/**
 * 构建 ASS 文件头（[Script Info] + [V4+ Styles] + [Events] 表头）。
 * 样式从 SubtitleStyle 映射；位置不在此声明（逐事件用 \pos 控制）。
 *
 * 批6 成片包装：
 * - Default 的 Fontname 由 Arial 硬编码改为 resolveSubtitleFont(style.fontFamily)
 *   的 assFontName（配合 buildSubtitleFilter 的 fontsdir 钉到仓库 fonts/ 目录，
 *   中文字形两端可控）。
 * - 追加 Emphasis（金句花字）与 CardTitle/CardSub/CardHook/CardCta（片头尾卡）
 *   五个专用样式，字号全部经 resolveSubtitleFontPx 基准换算，不硬编码绝对像素。
 */
export function buildAssHeader(
  width: number,
  height: number,
  style?: SubtitleStyle
): string {
  const s: SubtitleStyle = {
    fontSize: style?.fontSize ?? 24,
    fontColor: style?.fontColor ?? "#FFFFFF",
    outlineColor: style?.outlineColor ?? "#000000",
    outlineWidth: style?.outlineWidth ?? 2,
    position: style?.position ?? "bottom",
    bold: style?.bold ?? false,
    backgroundBox: style?.backgroundBox ?? false,
  };
  // ASS Fontsize 基于 PlayResY(=height)。fontSize 以 1080 基准高定义，
  // 这里按实际成片高线性缩放 → 跨分辨率(480p/720p/1080p)字号视觉占比一致，
  // 且与预览端共用 resolveSubtitleFontPx，保证「预览字号 = 成片字号」。
  const fontSize = resolveSubtitleFontPx(s.fontSize, height);
  const primary = hexToAssColor(s.fontColor);
  const outline = hexToAssColor(s.outlineColor);
  const bold = s.bold ? -1 : 0; // ASS: -1=粗体 0=常规
  // BorderStyle: 3=底框(OpaqueBox) 1=描边(Outline)
  const borderStyle = s.backgroundBox ? 3 : 1;
  // BackColour 用于 OpaqueBox 底框（半透明黑，alpha 80）
  const backColour = "&H80000000";
  // 正文/字幕字体：白名单解析（替换旧 Arial 硬编码，中文字形两端可控）
  const bodyFont = resolveSubtitleFont(style?.fontFamily).assFontName;
  // 标题/花字/卡片字体：得意黑（显示型斜体，冲击力强）
  const titleFont = resolveSubtitleFont(TITLE_FONT_ID).assFontName;

  // ── 金句花字 Emphasis：正文字号 × fontScale、暖金主色、更粗描边、粗体 ──
  const emphasisSize = Math.max(
    1,
    Math.round(fontSize * EMPHASIS_STYLE.fontScale)
  );
  const emphasisColor = hexToAssColor(EMPHASIS_STYLE.color);
  const emphasisOutline = Math.max(
    1,
    Math.round(s.outlineWidth * EMPHASIS_STYLE.outlineScale)
  );

  // ── 片头/片尾卡样式组：字号全部以 fontSize 为基准按倍率派生（勿硬编码像素）──
  // CardTitle 剧名大字，CardSub 集数，CardHook 钩子悬念，CardCta 追更贴字。
  // 字号倍率 / 配色 / 描边倍率读 CARD_STYLE 单一真源（与平台封面共用）。
  const cardTitleSize = resolveSubtitleFontPx(
    s.fontSize * CARD_STYLE.titleScale,
    height
  );
  const cardSubSize = resolveSubtitleFontPx(
    s.fontSize * CARD_STYLE.subScale,
    height
  );
  const cardHookSize = resolveSubtitleFontPx(
    s.fontSize * CARD_STYLE.hookScale,
    height
  );
  const cardCtaSize = resolveSubtitleFontPx(
    s.fontSize * CARD_STYLE.ctaScale,
    height
  );
  const whiteColor = hexToAssColor(CARD_STYLE.fillColor);
  const blackOutline = hexToAssColor(CARD_STYLE.outlineColor);
  const cardCtaColor = hexToAssColor(CARD_STYLE.ctaColor);
  // 卡片描边加粗保证大字在任意底图上可读（正文描边宽 × outlineScale，最小 2）
  const cardOutline = Math.max(
    2,
    Math.round(s.outlineWidth * CARD_STYLE.outlineScale)
  );

  // Alignment 用 5（中心）；逐事件 \an5\pos 会覆盖，这里仅作缺省
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${bodyFont},${fontSize},${primary},&H000000FF,${outline},${backColour},${bold},0,0,0,100,100,0,0,${borderStyle},${s.outlineWidth},0,5,20,20,20,1`,
    // 金句花字：大字号 + 暖金 + 粗描边 + 粗体，BorderStyle 恒 1（描边，不套底框）
    `Style: Emphasis,${bodyFont},${emphasisSize},${emphasisColor},&H000000FF,${blackOutline},${backColour},-1,0,0,0,100,100,0,0,1,${emphasisOutline},0,5,20,20,20,1`,
    // 卡片标题：得意黑巨字，白字粗描边
    `Style: CardTitle,${titleFont},${cardTitleSize},${whiteColor},&H000000FF,${blackOutline},${backColour},-1,0,0,0,100,100,0,0,1,${cardOutline},0,5,20,20,20,1`,
    // 卡片副标题（集数）
    `Style: CardSub,${titleFont},${cardSubSize},${whiteColor},&H000000FF,${blackOutline},${backColour},0,0,0,0,100,100,0,0,1,${cardOutline},0,5,20,20,20,1`,
    // 卡片钩子悬念
    `Style: CardHook,${titleFont},${cardHookSize},${whiteColor},&H000000FF,${blackOutline},${backColour},-1,0,0,0,100,100,0,0,1,${cardOutline},0,5,20,20,20,1`,
    // 卡片追更贴字（暖金强调色，读 CARD_STYLE.ctaColor 单一真源）
    `Style: CardCta,${titleFont},${cardCtaSize},${cardCtaColor},&H000000FF,${blackOutline},${backColour},0,0,0,0,100,100,0,0,1,${cardOutline},0,5,20,20,20,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "",
  ].join("\n");
}

/**
 * 转义 ASS 事件文本：大括号会被当标签起止符，需转义；换行转 \N。
 */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/**
 * 构造单条 Dialogue 事件的「入场动效」libass 覆盖标签前缀（不含正文文本）。
 *
 * 与预览端 preview-player 的 CSS keyframes 时序一一对齐（读同一份 SUBTITLE_ANIM），
 * 保证「预览=成片」。各动效标签语义：
 *   - none       {\an5\pos(x,y)}                          仅居中定位，无动效
 *   - fade       {\an5\pos(x,y)\fad(f,f)}                 淡入淡出（旧默认，f=fadeMs）
 *   - slideup    {\an5\move(x,y+dy,x,y,0,ms)\fad(fi,fi)}  从下方 dy 处上滑到位 + 轻淡入
 *                 \move 取代 \pos；dy=round(height*slideUpOffsetRatio)
 *   - pop        {\an5\pos(x,y)\fscx60\fscy60\t(0,ms,\fscx100\fscy100)\fad(fi,fi)}
 *                 从 popStartScale 缩放弹入到 100% + 轻淡入
 * typewriter 不走此函数（逐字符 alpha 揭示在 buildAssEventText 内单独处理）。
 *
 * @param animation 动效类型（typewriter 传入会回退为 none 前缀，正文由调用方逐字构造）
 * @param px,py     字幕中心点像素坐标
 * @param height    成片画面高（slideup 位移换算用）
 * @returns 形如 "{\an5...}" 的覆盖标签前缀
 */
export function buildAssAnimTags(
  animation: SubtitleAnimation,
  px: number,
  py: number,
  height: number
): string {
  const anchor = `\\an5`;
  switch (animation) {
    case "none":
      return `{${anchor}\\pos(${px},${py})}`;
    case "slideup": {
      // 起始点在目标下方 dy 像素处，slideUpMs 内滑到目标点
      const dy = Math.round(height * SUBTITLE_ANIM.slideUpOffsetRatio);
      const fadeIn = Math.round(SUBTITLE_ANIM.slideUpMs * 0.82);
      return `{${anchor}\\move(${px},${py + dy},${px},${py},0,${SUBTITLE_ANIM.slideUpMs})\\fad(${fadeIn},${fadeIn})}`;
    }
    case "pop": {
      const start = Math.round(SUBTITLE_ANIM.popStartScale * 100);
      const fadeIn = Math.round(SUBTITLE_ANIM.popMs * 0.67);
      return `{${anchor}\\pos(${px},${py})\\fscx${start}\\fscy${start}\\t(0,${SUBTITLE_ANIM.popMs},\\fscx100\\fscy100)\\fad(${fadeIn},${fadeIn})}`;
    }
    case "typewriter":
      // 打字机的定位标签同 none，逐字符 alpha 在 buildAssEventText 内拼装
      return `{${anchor}\\pos(${px},${py})}`;
    case "fade":
    default:
      return `{${anchor}\\pos(${px},${py})\\fad(${SUBTITLE_ANIM.fadeMs},${SUBTITLE_ANIM.fadeMs})}`;
  }
}

/**
 * 构造单条 Dialogue 事件的完整正文（覆盖标签 + 转义后的文本）。
 *
 * 非 typewriter：定位/动效标签前缀 + 整段一次性转义文本（保留 wrapSubtitleText
 * 插入的 \n 折行，escapeAssText 会转成 \N）。
 *
 * typewriter：逐字符 alpha 揭示。关键实现约束：
 *   1) 转义顺序——每个字符先各自 escapeAssText 转义，再前置其 {\alpha...} 标签块，
 *      使用户文本里的 `{` `}` 不会破坏标签结构（对齐任务约束「先转义再前置标签」）。
 *   2) 换行处理——wrapSubtitleText 用 \n 折行，先按 \n 切段；段间输出字面 \N 分隔符，
 *      绝不把 \N 这两个字符塞进某个 per-char alpha 块内。
 *   3) 延迟对齐——延迟由 typewriterDelays 基于「含换行槽位」的整段文本计算，
 *      与逐字符索引一一对应（换行也占一个槽），与 lib 侧共享规则完全一致。
 *   4) 不叠加 \fad——打字机靠 alpha 揭示，末尾随窗口结束硬切（避免 libass 下
 *      \fad 与逐字 \alpha 相互作用的边界问题）。
 *
 * @param wrapped        已折行（可能含 \n）但「未转义」的句子文本
 * @param animation      动效类型
 * @param px,py          字幕中心点像素坐标
 * @param height         成片画面高
 * @param windowDurSec   该句时间窗时长（秒），供 typewriter 压缩延迟
 * @returns 完整的 Dialogue 正文字符串（含前缀标签）
 */
export function buildAssEventText(
  wrapped: string,
  animation: SubtitleAnimation,
  px: number,
  py: number,
  height: number,
  windowDurSec: number
): string {
  const tags = buildAssAnimTags(animation, px, py, height);
  if (animation !== "typewriter") {
    return `${tags}${escapeAssText(wrapped)}`;
  }

  // ── 打字机：逐字符 alpha 揭示 ──
  // 延迟按「含换行槽位」的整段折行文本计算，索引与 Array.from(wrapped) 对齐。
  const chars = Array.from(wrapped);
  const delays = typewriterDelays(wrapped, windowDurSec);
  // 单字揭示的 alpha 过渡时长（毫秒）：短促硬揭示，节奏由 delays 主导
  const revealMs = 80;
  let body = "";
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    // 换行符：输出字面 \N 分隔，不包裹 alpha 块（槽位仍占用 → delays 索引已含它）
    if (ch === "\n" || ch === "\r") {
      body += "\\N";
      continue;
    }
    const startMs = Math.round(delays[i] * 1000);
    // 先转义单字符内容，再前置 alpha 标签块（用户文本含 {、} 不会破坏标签）
    const safeChar = escapeAssText(ch);
    body += `{\\alpha&HFF&\\t(${startMs},${startMs + revealMs},\\alpha&H00&)}${safeChar}`;
  }
  return `${tags}${body}`;
}

/**
 * 按每行最大字数手动折行（CJK 全角计 1 宽，ASCII 计 0.5 宽近似），
 * 使导出字幕块的行数/块高与预览端 maxWidth:90% 的换行一致，保证
 * \an5 中心锚点下同一 y 坐标的字幕占位相同（预览=导出）。
 * 保留用户已有的显式换行（先按 \n 分段，再对每段折行）。
 */
export function wrapSubtitleText(
  text: string,
  maxCharsPerLine: number
): string {
  // charWidth 复用 lib/subtitle-segments 的同源实现（CJK=1、ASCII=0.5），
  // 与逐句时间窗分配用同一视觉宽度基准，避免两处启发式漂移。
  const wrapParagraph = (para: string): string => {
    const lines: string[] = [];
    let line = "";
    let w = 0;
    for (const ch of para) {
      const cw = charWidth(ch);
      if (w + cw > maxCharsPerLine && line !== "") {
        lines.push(line);
        line = ch;
        w = cw;
      } else {
        line += ch;
        w += cw;
      }
    }
    if (line) lines.push(line);
    return lines.join("\n");
  };
  return text.split(/\r?\n/).map(wrapParagraph).join("\n");
}

/**
 * 格式化 ASS 时间：H:MM:SS.cs（百分秒，2 位）。
 */
export function formatAssTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

/**
 * 将 #RRGGBB 转换为 ASS 颜色格式 &H00BBGGRR
 * ASS 颜色顺序是 BGR（与 HTML 相反），alpha 通道 00 = 不透明
 */
export function hexToAssColor(hex: string): string {
  // 去掉 # 号，提取 RGB 分量
  const cleaned = hex.replace(/^#/, "");
  const r = cleaned.substring(0, 2);
  const g = cleaned.substring(2, 4);
  const b = cleaned.substring(4, 6);
  // ASS 格式：&H{alpha:2}{B:2}{G:2}{R:2}，alpha 00 = 完全不透明
  return `&H00${b}${g}${r}`.toUpperCase();
}
