/**
 * 视频合成 —— 调色 / 字幕 / 水印滤镜字符串构建器
 *
 * 从 services/video-synthesis.ts 原样提取（零行为变更）：片段 FX 滤镜预设表、
 * 全片 LUT 调色、字幕 ass filter、水印 overlay 坐标表达式。
 * 除 LUT 需 existsSync 探测 .cube 文件外，其余均为纯字符串构建。
 */

import { existsSync } from "fs";
import path from "path";
import { createLogger } from "@/lib/logger";
import type { SceneEffectId, Watermark } from "@/types/export-style";
// 全片 LUT 调色（批6）：id → .cube 预设白名单，导出端 lut3d 统一色调。
import { resolveLutPreset, type ColorGrade } from "@/lib/color-grade";

const log = createLogger("services:video-synthesis");

/**
 * 片段滤镜预设：id → FFmpeg 滤镜表达式
 * 移植自 MagicalCanvas，覆盖常用调色/做旧效果。
 */
export const FX_FILTERS: Record<SceneEffectId, string> = {
  bw: "hue=s=0",
  vivid: "eq=saturation=1.45:contrast=1.08",
  sepia: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
  cold: "colorbalance=bs=.18:rs=-.05",
  warm: "colorbalance=rs=.16:bs=-.12",
  vignette: "vignette=PI/4.5",
  blur: "gblur=sigma=8",
  oldfilm:
    "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,noise=alls=10:allf=t,vignette=PI/4.5",
  sharpen: "unsharp=5:5:1.0",
  vintage: "curves=preset=vintage",
  tealorange: "colorbalance=rs=.2:bs=-.2,eq=saturation=1.25",
  dreampurple: "colorbalance=rs=.1:bs=.25",
};

/**
 * 构建字幕 filter 片段（ASS 文件，样式与定位已内嵌，无需 force_style）。
 * 仅在 includeSubtitles && subtitlePath 不为 null 时调用。
 *
 * 批6：追加 fontsdir 钉到仓库 fonts/ 目录（内置思源黑体 OTF / 得意黑 TTF 所在），
 * 让 libass 从仓库自带字体加载，摆脱对系统字体的依赖（此前 Arial 硬编码时代
 * 服务器无中文字体则字幕方框乱码）。转义方式与 assPath 完全一致。
 */
export function buildSubtitleFilter(subtitlePath: string): string {
  // 转义路径中的特殊字符（FFmpeg filter 语法要求）
  const escapePath = (p: string): string =>
    p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

  const escapedPath = escapePath(subtitlePath);
  // 内置字体目录（绝对路径）：仓库 fonts/ 下的全字集 OTF/TTF
  const fontsDir = escapePath(path.join(process.cwd(), "fonts"));

  // ASS 文件用 ass filter（样式与逐条 \pos 定位全部内嵌在文件中，无需 force_style）；
  // fontsdir 指定字体加载目录，与 ASS Style 的 Fontname（assFontName）配套。
  return `ass='${escapedPath}':fontsdir='${fontsDir}'`;
}

/**
 * 构建全片 LUT 调色滤镜片段（批6）：`lut3d='<.cube 绝对路径>'`。
 *
 * 治「跨 provider 每镜色温各异的素材拼接感」：终混时在 scale+pad 之后、字幕之前
 * 统一染色（字幕/水印/贴图不受影响，因它们在染色之后叠加）。
 *
 * 优雅降级（不阻塞导出）：
 *   - colorGrade 未启用 / 缺省 → 返回 null（不插滤镜）；
 *   - lutId 白名单外（resolveLutPreset 返回 null）→ 返回 null；
 *   - .cube 文件不存在（existsSync 失败）→ log.warn 后返回 null。
 * 返回 null 时调用方不拼 lut3d，成片仍正常导出（只是无统一调色）。
 *
 * @returns lut3d 滤镜片段（如 `lut3d='/abs/vivid-anime.cube'`）或 null
 */
export function buildColorGradeFilter(colorGrade?: ColorGrade): string | null {
  if (!colorGrade?.enabled) return null;
  const preset = resolveLutPreset(colorGrade.lutId);
  if (!preset) return null;
  // .cube 相对 app 运行目录（public/luts/x.cube）→ 拼绝对路径
  const cubeAbsPath = path.join(process.cwd(), preset.cubeFile);
  if (!existsSync(cubeAbsPath)) {
    log.warn(`LUT .cube 文件不存在，跳过调色: ${cubeAbsPath}`);
    return null;
  }
  // 转义方式与字幕路径一致（FFmpeg filter 语法要求）
  const escaped = cubeAbsPath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
  return `lut3d='${escaped}'`;
}

/**
 * 获取水印位置的 FFmpeg overlay 坐标表达式（边距 20px）
 */
export function getWatermarkOverlayExpr(
  position: Watermark["position"]
): string {
  const map: Record<Watermark["position"], string> = {
    tl: "20:20",
    tr: "W-w-20:20",
    bl: "20:H-h-20",
    br: "W-w-20:H-h-20",
    center: "(W-w)/2:(H-h)/2",
  };
  return map[position];
}
