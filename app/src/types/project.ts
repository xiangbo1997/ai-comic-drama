/**
 * 项目相关类型定义
 */

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
}

/** 项目基础信息 */
export interface Project {
  id: string;
  title: string;
  status: ProjectStatus;
  style: string;
  aspectRatio: string;
  generationParams?: GenerationParams;
}

/** 项目详情（含关联数据，编辑器使用） */
export interface ProjectDetail extends Project {
  inputText: string | null;
  scenes: Scene[];
  characters: Array<{ character: Character }>;
}

/** 项目列表项（列表页使用） */
export interface ProjectListItem extends Project {
  scenesCount: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
}

// 避免循环引用，这里仅声明依赖类型的 import
import type { Scene } from "./scene";
import type { Character } from "./character";
