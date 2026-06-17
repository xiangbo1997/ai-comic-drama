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
  /** 字幕显示位置，默认 bottom */
  position: "top" | "middle" | "bottom";
  /** 是否加粗，默认 false */
  bold: boolean;
  /** 是否显示背景色块（提升可读性），默认 false */
  backgroundBox: boolean;
}

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
 * 单分镜的画面调节配置（滤镜 / 变速）
 * 按 sceneId 关联，导出时作用于该分镜片段。
 */
export interface SceneEffect {
  /** 归属分镜 id */
  sceneId: string;
  /** 滤镜预设 id；缺省或 null = 不加滤镜 */
  effect?: SceneEffectId | null;
  /** 变速倍率（0.25–4），默认 1（不变速） */
  speed?: number;
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
