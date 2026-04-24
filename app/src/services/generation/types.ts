/**
 * 图像生成编排器类型定义
 */

import type {
  AIServiceConfig,
  CharacterInfo,
  CharacterAppearance,
} from "@/types";
import type { ImageProviderCapability } from "@/services/ai/types";

/** 生成策略 */
export type GenerationStrategy = "prompt_only" | "reference_edit" | "face_id";

/** 角色在场景中的角色类型 */
export type CharacterRole = "primary" | "secondary" | "background";

/** 场景角色信息（增强版，含参考资产） */
export interface SceneCharacterInfo extends CharacterInfo {
  id: string;
  role: CharacterRole;
  canonicalImageUrl?: string;
  appearance?: CharacterAppearance | null;
  faceEmbedding?: number[];
}

/** 编排器生成请求 */
export interface OrchestratorRequest {
  prompt: string;
  sceneId?: string;
  projectId?: string;
  characters: SceneCharacterInfo[];
  shotType?: string;
  emotion?: string;
  style?: string;
  aspectRatio?: "1:1" | "9:16" | "16:9";
  imageConfig: AIServiceConfig;
  llmConfig?: AIServiceConfig;
  userId: string;
  maxRetries?: number;
  /**
   * Stage 1.4 引入：客户端/上游显式传入的 negative prompt。
   * Orchestrator 会透传给 provider；不支持原生 negative 的 provider 由适配层降级。
   */
  negativePrompt?: string;
  /**
   * Stage 1.4 引入：显式的参考图列表。
   * 若提供，覆盖 strategy-resolver 基于主角色推断出的单张 canonicalImage；
   * 常用于用户在 UI 手动指定多张参考图的场景。
   */
  referenceImages?: string[];
}

/** 策略决策结果 */
export interface StrategyDecision {
  strategy: GenerationStrategy;
  primaryCharacter?: SceneCharacterInfo;
  /** 最主要的参考图（向后兼容单图场景） */
  referenceImageUrl?: string;
  /** Stage 1.4：多张参考图（支持 IP-Adapter/多图 reference） */
  referenceImageUrls?: string[];
  enhancedPrompt: string;
  capability: ImageProviderCapability;
}

/** 验证结果 */
export interface ValidationResult {
  passed: boolean;
  faceCount: number;
  scores: Record<string, number>;
  shouldRetry: boolean;
  reason?: string;
}

/** 编排器生成结果 */
export interface OrchestratorResult {
  imageUrl: string;
  strategy: GenerationStrategy;
  attemptCount: number;
  validation?: ValidationResult;
}
