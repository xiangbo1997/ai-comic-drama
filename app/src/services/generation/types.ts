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
  /**
   * 多角度参考图（三视图 front/side/back 在前 + 定妆图兜底，已去重）。
   * 与手动路径客户端 collectCharacterRefs 的收集规则一致；
   * 提供时 strategy-resolver 优先消费本字段，缺失时回退单张 canonicalImageUrl。
   */
  referenceImageUrls?: string[];
  /**
   * 三视图参考资产（含 pose：front|side|back|3quarter）。
   * 朝向感知选择用它按分镜里角色朝向挑代表图；缺省时回退 canonicalImageUrl 逻辑（零回归）。
   */
  referenceAssets?: Array<{ url: string; pose?: string | null }>;
  appearance?: CharacterAppearance | null;
  faceEmbedding?: number[];
  /**
   * 用户预设服装（外观编辑器手填 / AI 起草，来自 CharacterAppearance.clothingPresets）。
   * 场景定妆照换装时按 name↔outfit 模糊匹配，命中且带 imageRef 时直接用用户手挑参考图；
   * 缺省 undefined 时换装走缓存/自动衍生路径（零回归）。
   */
  clothingPresets?: Array<{
    name: string;
    description?: string;
    imageRef?: string;
  }> | null;
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
  /**
   * 迭代式生成：参考图是「上一版整图」而非角色定妆脸。
   * 为 true 时 strategy-resolver 改用迭代友好的 reference_edit 措辞
   * （以整图为基础、保留构图与身份、按需改动），避免默认「锁死角色外貌」
   * 与用户「改外貌类指令」冲突。
   */
  iterate?: boolean;
  /**
   * 朝向线索：分镜画面描述 / 镜头角度 / 构图。
   * orchestrator 据此推断角色朝向，从三视图 referenceAssets 里挑对应朝向的代表图
   * （朝向感知三视图选择）。缺省时朝向按默认 front 处理（零回归）。
   */
  sceneFacingHints?: {
    description?: string | null;
    cameraAngle?: string | null;
    composition?: string | null;
  };
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
  /**
   * 是否为「跳过评审的放行」而非「评审通过」。
   * true = 校验未实际执行（协议不支持/无参考图/config 缺失/校验器异常），
   * 为不阻断出图而 passed:true 放行——但一致性未经验证，下游据此区分展示，
   * 不把「跳过」伪装成「合格」（a7 审计 P1-3/P1-5）。
   */
  skipped?: boolean;
}

/** 编排器生成结果 */
export interface OrchestratorResult {
  imageUrl: string;
  strategy: GenerationStrategy;
  attemptCount: number;
  validation?: ValidationResult;
}
