/**
 * 项目相关类型定义
 */

import type {
  SubtitleStyle,
  SubtitlePosition,
  Watermark,
  Sticker,
  Transition,
  SceneEffect,
  BackgroundMusic,
  SceneSfx,
} from "./export-style";

/** 项目状态 — 与 Prisma enum ProjectStatus 对齐 */
export type ProjectStatus = "DRAFT" | "PROCESSING" | "COMPLETED" | "FAILED";

/**
 * 项目生成参数（Stage 1.9 引入）
 * 持久化在 Project.generationParams(Json)；默认 {}。
 * 所有字段可选 —— 缺失时各 Agent 使用自己的硬编码默认。
 */
export interface GenerationParams {
  /** LLM 温度（分镜/角色/Storyboard 共用）；0-1 */
  temperature?: number;
  /** LLM top_p；0-1 */
  topP?: number;
  /** 图像风格强度（保留给 Stage 1.4+ 的 ipAdapterStrength 等场景） */
  styleStrength?: number;
  /** Negative prompt 预设键名（anime/realistic/comic/cinematic 等） */
  negativePreset?: string;
  /** 自定义 negative prompt（追加到预设之后） */
  customNegative?: string;
  /** 全片统一字幕样式（导出时写入 ASS 头；位置作为未拖拽分镜的全局默认） */
  subtitleStyle?: SubtitleStyle;
  /** 字幕逐分镜位置覆盖（按 sceneId，归一化坐标）；缺省回退 subtitleStyle.position */
  subtitlePositions?: SubtitlePosition[];
  /** 全片商标水印配置 */
  watermark?: Watermark;
  /** 贴图列表（按分镜叠加） */
  stickers?: Sticker[];
  /** 分镜间转场配置（第 k 项 = 第 k 与 k+1 分镜之间；缺省 fade 0.3s） */
  transitions?: Transition[];
  /** 分镜级滤镜 / 变速（按 sceneId 关联） */
  sceneEffects?: SceneEffect[];
  /** 全片背景音乐（BGM）配置 */
  backgroundMusic?: BackgroundMusic;
  /** 音效列表（按 sceneId + 镜内偏移触发；导出/预览的第三音频层） */
  sfx?: SceneSfx[];
  /** 一键 AI 制片人审阅态（仅向导创建的项目有此字段；常规项目缺省） */
  producerReview?: ProducerReview;
}

/** 一键 AI 制片人审阅确认集（计划 §6 · 3.1） */
export interface ProducerReviewConfirmed {
  /** 世界观分区已确认 */
  worldview: boolean;
  /** 脚本分区已确认 */
  script: boolean;
  /** 已确认的角色 id 列表 */
  characters: string[];
  /** 已确认的分镜 id 列表 */
  scenes: string[];
}

/** 一键 AI 制片人审阅态（落 generationParams.producerReview） */
export interface ProducerReview {
  /** 标记本项目由制片人向导创建——常规项目无此字段 */
  createdByProducer: true;
  confirmed: ProducerReviewConfirmed;
}

/** 项目基础信息 */
export interface Project {
  id: string;
  title: string;
  status: ProjectStatus;
  style: string;
  aspectRatio: string;
  generationParams?: GenerationParams;
  /** 所属系列 ID（null=独立项目） */
  seriesId?: string | null;
  /** 集数（1 起）；仅 seriesId 非空时有意义 */
  episodeNumber?: number | null;
}

/** 项目详情（含关联数据，编辑器使用） */
export interface ProjectDetail extends Project {
  inputText: string | null;
  scenes: Scene[];
  characters: Array<{ character: Character }>;
  /** 系列上下文（徽标/上下集导航/世界观预填）；独立项目为 null */
  series?: ProjectSeriesInfo | null;
}

/** 项目列表项（列表页使用） */
export interface ProjectListItem extends Project {
  scenesCount: number;
  /** 管线各步完成数（列表卡进度点用；缺省视为 0） */
  imageCount?: number;
  videoCount?: number;
  audioCount?: number;
  /** 有台词/旁白（需配音）的分镜数——配音进度分母 */
  speakableCount?: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
}

// 避免循环引用，这里仅声明依赖类型的 import
import type { Scene } from "./scene";
import type { Character } from "./character";
import type { ProjectSeriesInfo } from "./series";
