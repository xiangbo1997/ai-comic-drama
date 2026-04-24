/**
 * Agent Pipeline 类型定义
 * Hybrid Plan-and-Execute 架构的核心类型系统
 */

import type { AIServiceConfig, ParsedScript, CharacterInfo } from "@/types";

// ============ Agent 基础接口 ============

/** Agent 泛型接口 — 所有 Agent 必须实现 */
export interface Agent<TInput, TOutput> {
  readonly name: string;
  run(input: TInput, context: WorkflowContext): Promise<AgentResult<TOutput>>;
}

/** Agent 执行结果 */
export interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  /** Agent 的推理过程，可展示给用户 */
  reasoning?: string;
  attempts: number;
  tokensUsed: number;
}

// ============ Workflow 上下文 ============

/** 用户配置的各类 AI 服务 */
export interface WorkflowConfig {
  llm?: AIServiceConfig;
  image?: AIServiceConfig;
  video?: AIServiceConfig;
  tts?: AIServiceConfig;
  /** 全自动 or 逐步确认 */
  mode: "auto" | "step_by_step";
  /** 图像 Reflection 最大轮次 */
  maxImageReflectionRounds: number;
  /** 图像生成风格 */
  style: string;
  /** Stage 1.10：用户可调的生成参数（来自 Project.generationParams） */
  generationParams?: {
    temperature?: number;
    topP?: number;
    styleStrength?: number;
    negativePreset?: string;
    customNegative?: string;
  };
}

/** Workflow 运行时上下文 */
export interface WorkflowContext {
  workflowRunId: string;
  projectId: string;
  userId: string;
  config: WorkflowConfig;
  artifacts: ArtifactStore;
  /** 发送实时事件（SSE） */
  emit: (event: WorkflowEvent) => void;
}

// ============ Artifact 系统 ============

export type ArtifactType =
  | "script"
  | "character_bible"
  | "storyboard"
  | "scene_image"
  | "scene_video"
  | "scene_audio"
  | "export";

export interface Artifact<T = unknown> {
  id: string;
  type: ArtifactType;
  version: number;
  data: T;
  createdBy: string;
  quality?: QualityScore;
  createdAt: Date;
}

/** 质量评分 */
export interface QualityScore {
  /** 0-100 综合评分 */
  overall: number;
  /** 各维度评分 */
  dimensions: Record<string, number>;
  pass: boolean;
  feedback?: string;
}

/** Artifact 存取接口 */
export interface ArtifactStore {
  get<T>(type: ArtifactType, id?: string): Artifact<T> | undefined;
  set<T>(artifact: Artifact<T>): void;
  getAll<T>(type: ArtifactType): Artifact<T>[];
}

// ============ Workflow 步骤定义 ============

export type WorkflowStep =
  | "parse_script"
  | "build_character_bible"
  | "build_storyboard"
  | "generate_images"
  | "review_images"
  | "generate_videos"
  | "synthesize_voice"
  | "export_project";

/** Workflow 步骤执行信息 */
export interface WorkflowStepInfo {
  step: WorkflowStep;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  agentName: string;
  attempts: number;
  tokensUsed: number;
  reasoning?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/** Workflow 运行状态 */
export type WorkflowRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "PAUSED";

/** Workflow 运行状态（完整） */
export interface WorkflowStatus {
  id: string;
  projectId: string;
  status: WorkflowRunStatus;
  currentStep: WorkflowStep | null;
  steps: WorkflowStepInfo[];
  progress: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

// ============ Workflow 事件（SSE） ============

export type WorkflowEventType =
  | "workflow:started"
  | "workflow:completed"
  | "workflow:failed"
  | "step:started"
  | "step:completed"
  | "step:failed"
  | "agent:thinking"
  | "agent:reflection"
  | "progress:update";

export interface WorkflowEvent {
  type: WorkflowEventType;
  workflowRunId: string;
  step?: WorkflowStep;
  data: Record<string, unknown>;
  timestamp: Date;
  /** Stage 2.4：单调递增序号（Redis PubSub 不保证顺序；客户端据此排序/去重） */
  seq?: number;
}

// ============ 各 Agent 的 Input/Output 类型 ============

/** ScriptParserAgent 输入 */
export interface ScriptParserInput {
  text: string;
}

/** ScriptParserAgent 输出 — 复用已有 ParsedScript 并扩展 */
export interface ScriptArtifact extends ParsedScript {
  /** 文本分段信息（超长文本分段解析时使用） */
  segments?: number;
}

/** CharacterBibleAgent 输入 */
export interface CharacterBibleInput {
  script: ScriptArtifact;
  /** 已有的角色数据（来自项目数据库） */
  existingCharacters?: CharacterInfo[];
}

/** 角色圣经 — 核心创新，确保跨场景一致性 */
export interface CharacterBible {
  characters: CharacterBibleEntry[];
}

export interface CharacterBibleEntry {
  name: string;
  /** 原始描述 */
  description: string;
  /** 标准化的图像生成提示词 — 所有场景复用 */
  canonicalPrompt: string;
  /** 结构化外貌（与已有 CharacterAppearance 对齐） */
  appearance: {
    gender: string;
    age: string;
    hairStyle: string;
    hairColor: string;
    faceShape: string;
    eyeColor: string;
    bodyType: string;
    skinTone: string;
    height: string;
    clothing: string;
    accessories: string;
  };
  /** 语音配置建议 */
  voiceProfile: {
    gender: string;
    age: string;
    tone: string;
  };
  /** 出场场景 ID 列表 */
  appearances: number[];
}

/** StoryboardAgent 输入 */
export interface StoryboardInput {
  script: ScriptArtifact;
  characterBible: CharacterBible;
}

/** 补全后的分镜 */
export interface SceneArtifact {
  id: number;
  order: number;
  shotType: string;
  /** 增强后的画面描述（含构图细节） */
  description: string;
  /** 用于图像生成的完整提示词 */
  imagePrompt: string;
  characters: string[];
  dialogue: string | null;
  narration: string | null;
  emotion: string;
  duration: number;
  /** 运镜方向 */
  cameraMovement?: string;
  /** 转场效果 */
  transition?: string;
}

export interface StoryboardArtifact {
  scenes: SceneArtifact[];
}

/** ImageConsistencyAgent 输入 */
export interface ImageGenerationInput {
  scene: SceneArtifact;
  characterBible: CharacterBible;
  /** 已有的参考图（如有） */
  existingReferenceImages?: Record<string, string>;
}

/** 图像生成结果 */
export interface ImageArtifact {
  sceneId: number;
  imageUrl: string;
  strategy: string;
  attempts: number;
  quality?: QualityScore;
}

/** ObserverAgent 评审输入 */
export interface ObserverInput {
  /** 被评审的内容类型 */
  contentType: "image" | "script" | "storyboard";
  /** 图像 URL（contentType=image 时） */
  imageUrl?: string;
  /** 对应的场景描述 */
  sceneDescription: string;
  /** 角色信息（用于一致性检查） */
  characterBible?: CharacterBible;
  /** 期望的情感/氛围 */
  expectedEmotion?: string;
  expectedShotType?: string;
}

/** ObserverAgent 评审结果 */
export interface ObserverVerdict {
  pass: boolean;
  score: QualityScore;
  /** 是否值得重试 */
  retryable: boolean;
  /** 改进建议（供 Reflection 使用） */
  suggestions: string[];
}
