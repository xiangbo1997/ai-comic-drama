/**
 * 内置中文字体白名单（批6 成片包装）——预览端与导出端的单一真源。
 *
 * 两端同字形契约：
 * - 导出端（video-synthesis）：ASS Style 的 Fontname 用 assFontName，
 *   ass 滤镜追加 fontsdir 钉到仓库 fonts/ 目录（serverFile 所在），
 *   摆脱对系统字体的依赖（Arial 硬编码时代中文字形不可控）。
 * - 预览端（preview-player / globals.css）：@font-face 以 cssFamily 声明
 *   webFile（GB2312 全集子集化 woff2，控制体积），字幕层 font-family 引用之。
 *   罕见字回退系统黑体（预览近似，导出端 OTF/TTF 为全字集不受影响）。
 *
 * 字体均为 SIL OFL 1.1 开源（许可证文本随字体置于 fonts/ 目录）：
 * - 思源黑体 CN（Adobe Source Han Sans CN）—— 正文/字幕默认
 * - 得意黑（atelierAnchor Smiley Sans Oblique）—— 标题/花字的斜体显示字体
 */

/** 字体白名单 id（SubtitleStyle.fontFamily 的合法取值） */
export type SubtitleFontId = "source-han-sans" | "smiley-sans";

/** 单款内置字体的两端映射描述 */
export interface SubtitleFontSpec {
  id: SubtitleFontId;
  /** UI 展示名 */
  label: string;
  /** ASS Style Fontname（须与字体文件内部英文 family 名一致，libass 按此匹配） */
  assFontName: string;
  /** 预览端 CSS font-family 值（与 @font-face 声明一致，带回退栈） */
  cssFamily: string;
  /** 预览端 @font-face 的字体文件（public 下的 URL 路径） */
  webFile: string;
  /** 导出端全字集字体文件（相对 app 运行目录，供 fontsdir 定位校验） */
  serverFile: string;
}

/** 内置字体清单（白名单，两端共用） */
export const SUBTITLE_FONTS: SubtitleFontSpec[] = [
  {
    id: "source-han-sans",
    label: "思源黑体",
    assFontName: "Source Han Sans CN",
    cssFamily:
      '"Source Han Sans CN", "PingFang SC", "Microsoft YaHei", sans-serif',
    webFile: "/fonts/SourceHanSansCN-Subset.woff2",
    serverFile: "fonts/SourceHanSansCN-Regular.otf",
  },
  {
    id: "smiley-sans",
    label: "得意黑",
    assFontName: "Smiley Sans Oblique",
    cssFamily:
      '"Smiley Sans Oblique", "Source Han Sans CN", "PingFang SC", sans-serif',
    webFile: "/fonts/SmileySans-Oblique.woff2",
    serverFile: "fonts/SmileySans-Oblique.ttf",
  },
];

/** 默认字幕字体（替换旧 Arial 硬编码；老配置无 fontFamily 字段时按此解析） */
export const DEFAULT_SUBTITLE_FONT_ID: SubtitleFontId = "source-han-sans";

/**
 * 片头/片尾卡与金句花字的「标题字体」：得意黑（显示型斜体，冲击力强）。
 * 两端共用此常量，避免各自硬编码。
 */
export const TITLE_FONT_ID: SubtitleFontId = "smiley-sans";

/**
 * 解析字体 id → 字体描述：白名单外/缺省一律回退默认字体（防任意字符串注入 ASS）。
 */
export function resolveSubtitleFont(id?: string | null): SubtitleFontSpec {
  const found = SUBTITLE_FONTS.find((f) => f.id === id);
  return (
    found ?? SUBTITLE_FONTS.find((f) => f.id === DEFAULT_SUBTITLE_FONT_ID)!
  );
}
