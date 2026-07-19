/**
 * 全片 LUT 调色（批6 成片包装）——预览端与导出端的单一真源。
 *
 * 治「跨 provider 每镜色温各异的素材拼接感」：导出终混时在 scale+pad 之后、
 * 字幕之前插一记 lut3d 全片统一调色（字幕/水印/贴图不受染色影响）。
 *
 * 两端契约：
 * - 导出端（video-synthesis）：ffmpeg `lut3d='<public/luts/*.cube 绝对路径>'`。
 * - 预览端（preview-player）：cssFilter 近似复现（CSS filter 无法精确等价 3D LUT，
 *   UI 须明示「预览为近似效果」）。
 *
 * 配置存于 Project.generationParams.colorGrade（JSON 白名单位，零 schema 变更），
 * 默认关闭——预览与导出有色差风险，用户显式开启才生效。
 * .cube 文件为脚本生成的自有资产（33³，无第三方版权负担），随 git 提交。
 */

/** LUT 预设 id 白名单 */
export type LutId = "warm-nostalgic" | "cold-steel" | "vivid-anime";

/** 单个 LUT 预设的两端映射描述 */
export interface LutPreset {
  id: LutId;
  /** UI 展示名 */
  label: string;
  /** 一句话风格说明（UI 辅助文案） */
  description: string;
  /** .cube 文件（相对 app 运行目录 public/luts/，导出端拼绝对路径） */
  cubeFile: string;
  /** 预览端近似 CSS filter（标注「预览近似」） */
  cssFilter: string;
}

/** 内置 LUT 预设清单（白名单，两端共用） */
export const LUT_PRESETS: LutPreset[] = [
  {
    id: "warm-nostalgic",
    label: "暖黄怀旧",
    description: "暖调提升 + 轻褪色，适合情感/回忆/年代题材",
    cubeFile: "public/luts/warm-nostalgic.cube",
    cssFilter:
      "sepia(0.14) saturate(1.02) brightness(1.03) contrast(1.01) hue-rotate(-4deg)",
  },
  {
    id: "cold-steel",
    label: "冷峻蓝",
    description: "冷色降饱和 + 对比增强，适合悬疑/都市/冲突题材",
    cubeFile: "public/luts/cold-steel.cube",
    cssFilter:
      "saturate(0.86) brightness(0.99) contrast(1.08) hue-rotate(6deg)",
  },
  {
    id: "vivid-anime",
    label: "高饱和漫感",
    description: "饱和度拉满 + S 曲线对比，最贴近日漫成片质感",
    cubeFile: "public/luts/vivid-anime.cube",
    cssFilter: "saturate(1.28) contrast(1.1)",
  },
];

/** 全片调色配置（存 generationParams.colorGrade） */
export interface ColorGrade {
  /** 是否启用（默认 false：预览与导出存在近似色差，显式开启才生效） */
  enabled: boolean;
  /** 选用的 LUT 预设 id */
  lutId: LutId;
}

/** 默认值：关闭；预设缺省给最贴合漫剧的高饱和漫感 */
export const DEFAULT_COLOR_GRADE: ColorGrade = {
  enabled: false,
  lutId: "vivid-anime",
};

/**
 * 解析 LUT id → 预设：白名单外/缺省返回 null（导出端 null 即不插 lut3d，
 * 防任意路径注入 ffmpeg filter）。
 */
export function resolveLutPreset(id?: string | null): LutPreset | null {
  return LUT_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * 圣经 ColorScript.overallTone（自由英文描述）→ LUT 预设推荐。
 * 关键词启发式：命中暖调词 → 暖黄怀旧；冷调词 → 冷峻蓝；
 * 高饱和词 → 高饱和漫感；无法判断返回 null（UI 不强推）。
 * 供导出弹窗「按圣经色调推荐」预选，用户显式选择永远优先。
 */
export function suggestLutFromTone(tone?: string | null): LutId | null {
  if (!tone) return null;
  const t = tone.toLowerCase();
  if (/(warm|amber|orange|sepia|golden|sunset|nostalg)/.test(t)) {
    return "warm-nostalgic";
  }
  if (/(cold|cool|blue|teal|steel|desaturat|muted|noir)/.test(t)) {
    return "cold-steel";
  }
  if (/(vivid|vibrant|saturat|colorful|pop|anime)/.test(t)) {
    return "vivid-anime";
  }
  return null;
}
