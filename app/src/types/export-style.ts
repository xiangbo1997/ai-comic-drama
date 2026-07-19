/**
 * 导出样式类型定义
 *
 * 作为视频导出功能中字幕样式与水印配置的权威类型来源。
 * - API 层（export/route.ts）读取此类型并传递给 video-synthesis 服务
 * - 前端组件消费此类型渲染样式配置 UI
 * - video-synthesis.ts（轨道A）需在 ExportOptions 中声明同名可选字段
 *
 * @since 2026-06-16
 */

/**
 * 字幕入场动效白名单。
 * 每个取值都必须在导出端（libass override 标签）与预览端（CSS keyframes）
 * 各有一套时序对齐的实现，保证「预览=成片」：
 *   - none       无动效，直接显示
 *   - fade       淡入（当前默认行为，等价旧 \fad(200,200)）
 *   - slideup    从下方短距离上滑入场 + 轻淡入
 *   - pop        从较小尺寸弹跳放大到正常 + 轻淡入
 *   - typewriter 逐字符依次显现（打字机效果）
 */
export type SubtitleAnimation =
  | "none"
  | "fade"
  | "slideup"
  | "pop"
  | "typewriter";

/**
 * 字幕样式配置
 * 控制视频合成时叠加字幕的视觉呈现
 */
export interface SubtitleStyle {
  /** 字体大小（px），默认 24 */
  fontSize: number;
  /** 字体颜色，hex 格式 #RRGGBB，默认 #FFFFFF */
  fontColor: string;
  /** 描边颜色，hex 格式 #RRGGBB，默认 #000000 */
  outlineColor: string;
  /** 描边宽度（px），默认 2 */
  outlineWidth: number;
  /**
   * 字幕全局默认位置，默认 bottom。
   * 作为「未单独拖拽过的分镜」的回退位置；单分镜可经 SubtitlePosition 覆盖。
   */
  position: "top" | "middle" | "bottom";
  /** 是否加粗，默认 false */
  bold: boolean;
  /** 是否显示背景色块（提升可读性），默认 false */
  backgroundBox: boolean;
  /**
   * 字幕入场动效，默认 fade（与旧行为一致）。
   * 可选字段：旧持久化配置无此字段时按 fade 解析（缺省 → "fade"），
   * 保证老项目导出/预览行为不变。
   */
  animation?: SubtitleAnimation;
  /**
   * 字幕字体（内置白名单 id，见 lib/subtitle-fonts.ts）。
   * 可选字段：老配置无此字段时按默认思源黑体解析（替换旧 Arial 硬编码，
   * 中文字形两端可控）。白名单外的值一律回退默认字体。
   */
  fontFamily?: string;
  /**
   * 全片默认字幕位置的「自由归一化中心点」x（0-1，相对画面宽）。
   *
   * position 只能表达纵向三档（顶/中/底、横向恒居中）；当用户在字幕样式面板里
   * 用九宫格或自由拖拽设置默认位置时，用 defaultX/defaultY 存精确坐标。
   * 二者「均为 number」时优先生效（见 resolveDefaultXY），否则回退 position。
   * 可选字段：老项目无此字段时行为不变（仍按 position 解析）。
   */
  defaultX?: number;
  /** 全片默认字幕位置的自由归一化中心点 y（0-1，相对画面高）。见 defaultX。 */
  defaultY?: number;
}

/**
 * 单分镜字幕位置覆盖（按 sceneId 关联）。
 *
 * 设计同 Sticker：用相对画面左上角的归一化坐标 0-1 存储，
 * 让「预览（缩放窗口）」与「导出（1080p 画面）」用各自画布尺寸还原同一相对位置，
 * 实现像素级一致。x/y 指字幕块的中心点（与拖拽手感一致）。
 *
 * 仅存「被用户单独拖动过的分镜」；未出现在数组中的分镜回退到
 * SubtitleStyle.position 的全局默认位置。
 */
export interface SubtitlePosition {
  /** 归属分镜 id */
  sceneId: string;
  /** 字幕中心点相对画面宽的横向比例 0-1（0=最左，0.5=水平居中，1=最右） */
  x: number;
  /** 字幕中心点相对画面高的纵向比例 0-1（0=最顶，0.5=垂直居中，1=最底） */
  y: number;
}

/**
 * 全局默认位置（top/middle/bottom）→ 归一化中心点坐标。
 *
 * 预览端与导出端共用此映射，保证「未拖拽的分镜」在两端落点一致。
 * 横向恒为 0.5（水平居中）；纵向留 10% 安全边距，避免字幕贴边被裁。
 */
export function presetPositionToXY(position: SubtitleStyle["position"]): {
  x: number;
  y: number;
} {
  switch (position) {
    case "top":
      return { x: 0.5, y: 0.12 };
    case "middle":
      return { x: 0.5, y: 0.5 };
    case "bottom":
    default:
      return { x: 0.5, y: 0.88 };
  }
}

/**
 * 解析「全片默认」字幕位置的归一化中心点：
 * 优先用自由坐标 defaultX/defaultY（九宫格/拖拽设置的精确位置，clamp 0-1），
 * 二者缺失时回退纵向三档 presetPositionToXY(position)。
 *
 * 预览端与导出端共用，保证「未单独拖拽的分镜」两端默认落点一致。
 */
export function resolveDefaultXY(style: SubtitleStyle | undefined): {
  x: number;
  y: number;
} {
  if (
    typeof style?.defaultX === "number" &&
    typeof style?.defaultY === "number"
  ) {
    return {
      x: Math.min(1, Math.max(0, style.defaultX)),
      y: Math.min(1, Math.max(0, style.defaultY)),
    };
  }
  return presetPositionToXY(style?.position ?? "bottom");
}

/**
 * 解析某分镜「最终生效」的字幕位置：优先用单分镜覆盖，否则回退全局默认。
 * 预览端与导出端共用，确保两端落点完全一致（预览=成片）。
 */
export function resolveSubtitleXY(
  sceneId: string,
  style: SubtitleStyle | undefined,
  positions: SubtitlePosition[] | undefined
): { x: number; y: number } {
  const override = positions?.find((p) => p.sceneId === sceneId);
  if (
    override &&
    typeof override.x === "number" &&
    typeof override.y === "number"
  ) {
    return {
      x: Math.min(1, Math.max(0, override.x)),
      y: Math.min(1, Math.max(0, override.y)),
    };
  }
  return resolveDefaultXY(style);
}

/**
 * 九宫格快捷位置预设：label → 归一化中心点坐标。
 * 供预览端「快捷选择位置」浮层使用；横/纵各取 0.5/0.12/0.88 三档组合。
 */
export const SUBTITLE_QUICK_POSITIONS: Array<{
  label: string;
  x: number;
  y: number;
}> = [
  { label: "左上", x: 0.18, y: 0.12 },
  { label: "上", x: 0.5, y: 0.12 },
  { label: "右上", x: 0.82, y: 0.12 },
  { label: "左", x: 0.18, y: 0.5 },
  { label: "中", x: 0.5, y: 0.5 },
  { label: "右", x: 0.82, y: 0.5 },
  { label: "左下", x: 0.18, y: 0.88 },
  { label: "下", x: 0.5, y: 0.88 },
  { label: "右下", x: 0.82, y: 0.88 },
];

/**
 * 字幕字号的「设计基准高」。
 *
 * SubtitleStyle.fontSize 的语义被定义为：「画面高 = 1080px 时的字号像素数」。
 * 任意实际画面高 H 下的真实字号 = fontSize × H / 1080（线性等比缩放）。
 *
 * 为什么需要基准高：字号必须相对画面高、而非绝对像素，才能在
 * ① 不同导出分辨率（480p/720p/1080p 画面高各异）
 * ② 预览小窗 vs 成片大画面
 * 之间保持「视觉占比一致」。预览端与导出端共用此基准 + 同一 fontSize，
 * 即可锁死字号视觉比例，实现「预览所见字号 = 成片字号」。
 */
export const SUBTITLE_FONT_BASE_HEIGHT = 1080;

/**
 * 把 SubtitleStyle.fontSize（基于 1080 基准高）换算为「实际画面高 frameHeight
 * 下的真实字号像素」。预览端（frameHeight=画面框像素高）与导出端
 * （frameHeight=成片分辨率高，写入 ASS Fontsize）共用，保证两端字号视觉一致。
 *
 * @param fontSize    用户配置的字号（基准高 1080 下的像素数），缺省 24
 * @param frameHeight 实际画面高（预览框 px 高 / 导出成片高），<=0 时回退基准高
 * @returns 取整后的真实字号像素（最小 1，避免 0 字号）
 */
export function resolveSubtitleFontPx(
  fontSize: number | undefined,
  frameHeight: number
): number {
  const base = typeof fontSize === "number" && fontSize > 0 ? fontSize : 24;
  const h = frameHeight > 0 ? frameHeight : SUBTITLE_FONT_BASE_HEIGHT;
  return Math.max(1, Math.round((base * h) / SUBTITLE_FONT_BASE_HEIGHT));
}

/**
 * 金句花字样式常量（批6 成片包装）——预览端与导出端的单一真源。
 *
 * 解析层按克制纪律（每集 1-3 处）标注的金句分镜（generationParams.emphasis，
 * sceneId 数组），其字幕以「大字号 + 强调色 + pop 弹入」花字渲染：
 * - 导出端：ASS 专用 Emphasis 样式（fontSize × fontScale、强调色、粗体）+ pop 动效
 * - 预览端：同倍率放大 + 同色 + pop CSS 动画
 * 正文字幕禁用花字（仅金句分镜生效），改数值只动这一处。
 */
export const EMPHASIS_STYLE = {
  /** 相对正文字号的放大倍率 */
  fontScale: 1.5,
  /** 花字主色（暖金，压得住深浅底） */
  color: "#FFD24D",
  /** 描边相对正文的放大倍率（大字需更粗描边保可读） */
  outlineScale: 1.5,
  /** 花字固定入场动效（视觉签名统一，不随全局 animation 变） */
  animation: "pop" as SubtitleAnimation,
} as const;

/** generationParams.emphasis 的金句分镜数上限（克制纪律：每集 1-3 处，从宽钳制） */
export const MAX_EMPHASIS_SCENES = 20;

/**
 * 水印（Logo）配置
 * 控制视频合成时叠加水印图片的位置与透明度
 */
export interface Watermark {
  /** 是否启用水印，默认 false */
  enabled: boolean;
  /** 水印图片 URL（需为 R2 公开 URL 或已签名 URL） */
  imageUrl: string;
  /**
   * 水印显示位置
   * tl = 左上, tr = 右上, bl = 左下, br = 右下, center = 居中
   * 默认 br
   */
  position: "tl" | "tr" | "bl" | "br" | "center";
  /** 不透明度 0-1（0=完全透明，1=完全不透明），默认 0.8 */
  opacity: number;
  /** 相对视频宽度的缩放比例 0-1，默认 0.12 */
  scale: number;
}

/**
 * 贴图 / 贴纸配置
 * 按分镜叠加图片（表情、Logo、装饰），导出时在该分镜时间段内 overlay。
 */
export interface Sticker {
  /** 唯一 id（前端生成） */
  id: string;
  /** 贴图图片 URL（R2 公开 URL） */
  imageUrl: string;
  /** 归属分镜 id（在该分镜时间段内显示） */
  sceneId: string;
  /** 相对画面左上角的位置 0-1 */
  x: number;
  y: number;
  /** 相对视频宽度的缩放比例 0-1，默认 0.2 */
  scale: number;
  /** 在该分镜内的出现偏移（秒），默认 0 */
  startOffset?: number;
  /** 持续时长（秒）；缺省=持续到分镜结束 */
  duration?: number;
}

/**
 * 转场类型白名单
 * 对应 FFmpeg xfade filter 的 transition 取值（ffmpeg ≥ 4.3 内置）。
 * "none" 为硬切（用极短淡化≈0 实现，统一管线）。
 */
export type TransitionType =
  | "none"
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "dissolve"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "circleopen"
  | "circleclose"
  | "radial"
  | "smoothleft"
  | "smoothright";

/**
 * 分镜间转场配置
 * 第 k 项描述「第 k 个分镜」与「第 k+1 个分镜」之间的转场，
 * 因此长度应为 scenes.length - 1（缺省项按默认 fade 处理）。
 */
export interface Transition {
  /** 转场类型，默认 fade */
  type: TransitionType;
  /** 转场时长（秒），默认 0.3，范围 0.1–2.0 */
  duration: number;
}

/**
 * 片段滤镜特效预设 id 白名单
 * 对应 video-synthesis 的 FX_FILTERS 映射表。
 */
export type SceneEffectId =
  | "bw"
  | "vivid"
  | "sepia"
  | "cold"
  | "warm"
  | "vignette"
  | "blur"
  | "oldfilm"
  | "sharpen"
  | "vintage"
  | "tealorange"
  | "dreampurple";

/**
 * 图片分镜的 Ken Burns 运镜白名单（缓慢推拉/平移，杀「幻灯片感」）。
 * 对应 video-synthesis 的 zoompan 表达式；仅作用于「图片分镜」（视频分镜自带运动）。
 *   - zoomIn   缓慢推近（放大到 ≤1.12）
 *   - zoomOut  缓慢拉远（从 1.12 缩回 1.0）
 *   - panLeft  向左平移（横移镜头）
 *   - panRight 向右平移
 */
export type SceneMotion = "zoomIn" | "zoomOut" | "panLeft" | "panRight";

/**
 * 冲击表现力白名单（每镜至多一记「重音」，对应漫剧震屏/闪白/定格三大视觉签名）。
 * 对应 video-synthesis 的 ffmpeg 滤镜与预览端 CSS：
 *   - shake  震屏（正弦位移抖动，落在镜头前 ~0.6s）
 *   - flash  闪白（亮度脉冲 ~0.25s）
 *   - freeze 定格（镜尾冻结最后一帧 ~0.5s，在镜内定格而非延长时长）
 */
export type SceneImpact = "shake" | "flash" | "freeze";

/**
 * 单分镜的画面调节配置（滤镜 / 变速 / 运镜 / 冲击）
 * 按 sceneId 关联，导出时作用于该分镜片段。
 */
export interface SceneEffect {
  /** 归属分镜 id */
  sceneId: string;
  /** 滤镜预设 id；缺省或 null = 不加滤镜 */
  effect?: SceneEffectId | null;
  /** 变速倍率（0.25–4），默认 1（不变速） */
  speed?: number;
  /**
   * 图片分镜的 Ken Burns 运镜；缺省或 null = 由导出端按契约决定默认值
   * （图片分镜默认轻推 zoomIn，杀幻灯片感；视频分镜忽略此字段）。
   * 可选字段，老配置无此字段时按上述默认解析（向后兼容）。
   */
  motion?: SceneMotion | null;
  /**
   * 单镜冲击重音；缺省或 null = 无冲击。可选字段，老配置无此字段行为不变。
   */
  impact?: SceneImpact | null;
}

/**
 * 字幕样式默认值
 */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 24,
  fontColor: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidth: 2,
  position: "bottom",
  bold: false,
  backgroundBox: false,
  animation: "fade",
};

/**
 * 水印默认值
 */
export const DEFAULT_WATERMARK: Watermark = {
  enabled: false,
  imageUrl: "",
  position: "br",
  opacity: 0.8,
  scale: 0.12,
};

/**
 * 默认转场（与旧行为一致：fade 0.3s）
 */
export const DEFAULT_TRANSITION: Transition = {
  type: "fade",
  duration: 0.3,
};

/**
 * 单条音效（SFX）叠加配置（按 sceneId + 镜内偏移关联）。
 *
 * 存于 Project.generationParams.sfx（与 stickers/sceneEffects 同位，无需改 schema）。
 * 导出时由 video-synthesis 作为「第三音频层」（voice > SFX > BGM > ambient 混音
 * 层级）在 sceneStart + offsetSec 处触发；预览端同源在分镜起点 + offsetSec 调度
 * <audio> 播放（预览必须反映导出效果）。
 */
export interface SceneSfx {
  /** 归属分镜 id（在该分镜时间段内触发） */
  sceneId: string;
  /** 内置音效 SfxEntry.id（如 "glass-shatter"） */
  sfxId: string;
  /** 在该分镜内的触发偏移（秒），默认 0 */
  offsetSec: number;
  /** 音量 0-1；缺省时用该音效的 defaultVolume */
  volume?: number;
}

/**
 * 背景音乐（BGM）配置 —— 全片单条主音乐。
 * 存于 Project.generationParams.backgroundMusic（与 watermark/stickers 同位，
 * 无需改 schema）。导出时由 video-synthesis 用 ffmpeg 混入成片。
 */
export interface BackgroundMusic {
  /** 是否启用，默认 false */
  enabled: boolean;
  /** 内置曲库 BgmTrack.id（用于回显选中态；用户上传时为空） */
  trackId?: string;
  /** 实际拉取地址（内置曲库 /bgm/… 或用户上传 fileUrl） */
  url: string;
  /** 音量 0-1，相对原始 BGM，默认 0.25（压到对白之下） */
  volume: number;
  /** 淡入秒数，默认 1.5 */
  fadeIn: number;
  /** 淡出秒数，默认 2.0 */
  fadeOut: number;
  /** BGM 比成片短时是否循环铺满，默认 true */
  loop: boolean;
  /** 对白时自动压低 BGM（sidechain ducking），默认 false */
  ducking: boolean;
}

/**
 * 背景音乐默认值（enabled=false → 不混入，与旧行为一致）。
 *
 * ducking 默认 true：漫剧专业混音层级 voice > SFX > BGM > ambient，对白清晰是刚需，
 * 新建配置默认开启「对白时压低 BGM」。仅影响「未设置过 ducking」的新默认——
 * 已落库的存量配置带自己的 ducking 值，读取时不受此默认影响（值不变）。
 */
export const DEFAULT_BACKGROUND_MUSIC: BackgroundMusic = {
  enabled: false,
  url: "",
  volume: 0.25,
  fadeIn: 1.5,
  fadeOut: 2.0,
  loop: true,
  ducking: true,
};
