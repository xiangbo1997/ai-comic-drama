/**
 * 角色相关类型定义
 */

/** 角色基础信息 */
export interface Character {
  id: string;
  name: string;
  gender?: string | null;
  age?: string | null;
  description: string | null;
  voiceId: string | null;
  referenceImages: string[];
  /**
   * 定妆锚（已定稿判定的权威字段，批次 2 · 1.5）：非空即角色已确认定妆照。
   * 由三视图 / 首张参考图入库时写入；出图编排器优先消费此字段做跨镜头一致性。
   */
  canonicalImageUrl?: string | null;
  /** 参考图资产（含三视图 pose），生视频多参考用；老数据为 undefined */
  referenceAssets?: CharacterReferenceAsset[];
  /**
   * 结构化外貌。视频端 deriveIdentityPrompt 据此拼身份前缀（description 为空时
   * 的唯一身份约束来源）。
   * 注意：项目 GET（api/projects/[id]）走的是窄 select，只回传描述性字段，
   * 不含 clothingPresets —— 需要服装预设的调用方请走角色端点。
   */
  appearance?: CharacterAppearance | null;
}

/** 角色列表项（角色管理页使用，含额外字段） */
export interface CharacterListItem extends Character {
  voiceProvider: string | null;
  createdAt: string;
  tags?: CharacterTag[];
  // appearance / referenceAssets 已提到基接口 Character（两处声明完全相同，
  // 此前的重复声明只是冗余），角色管理页读法不变。
}

/** 角色标签关联 */
export interface CharacterTag {
  tagId: string;
  characterId: string;
  tag: Tag;
}

/** 标签 */
export interface Tag {
  id: string;
  name: string;
  category: string | null;
  color: string | null;
  isSystem: boolean;
}

/** 角色结构化外貌 */
export interface CharacterAppearance {
  id: string;
  characterId: string;
  hairStyle?: string | null;
  hairColor?: string | null;
  faceShape?: string | null;
  eyeColor?: string | null;
  bodyType?: string | null;
  height?: string | null;
  skinTone?: string | null;
  clothingPresets?: ClothingPreset[] | null;
  accessories?: string | null;
  freeText?: string | null;
}

/** 服装预设 */
export interface ClothingPreset {
  name: string;
  description: string;
  imageRef?: string;
}

/** 角色参考资产 */
export interface CharacterReferenceAsset {
  id: string;
  characterId: string;
  url: string;
  sourceType: "upload" | "ai_generated" | "canonical";
  isCanonical: boolean;
  pose?: string | null;
  qualityScore?: number | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  createdAt: string;
}

/** 角色人脸 Embedding */
export interface CharacterFaceEmbedding {
  id: string;
  characterId: string;
  embedding: number[];
  modelVersion: string;
  sourceAssetId?: string | null;
}

/** 生成尝试记录 */
export interface GenerationAttempt {
  id: string;
  taskId: string;
  attemptNumber: number;
  provider: string;
  model: string;
  strategy: "prompt_only" | "reference_edit" | "face_id";
  seed?: number | null;
  referenceAssetIds: string[];
  similarityScores?: Record<string, number> | null;
  faceCount?: number | null;
  passedValidation?: boolean | null;
  failureReason?: string | null;
  outputUrl?: string | null;
}

/** 角色信息（prompt 构建用） */
export interface CharacterInfo {
  name: string;
  gender?: string | null;
  age?: string | null;
  description?: string | null;
  referenceImages?: string[];
  appearance?: CharacterAppearance | null;
}

/** 角色动作（场景分析用） */
export interface CharacterAction {
  characterName: string;
  action: string;
  expression: string;
  position?: string;
}

/** 场景分析结果 */
export interface SceneAnalysis {
  characterActions: CharacterAction[];
  interaction?: string;
  environment: string;
  lighting?: string;
  mood: string;
  cameraAngle?: string;
}

/** 场景分析请求 */
export interface AnalyzeSceneRequest {
  sceneDescription: string;
  dialogue?: string;
  characters: CharacterInfo[];
  emotion?: string;
  shotType?: string;
  /** 上一镜画面描述（承接连续性：人物状态/道具/服装延续，不与前情冲突） */
  prevSceneDescription?: string;
  /** 下一镜画面描述（连续性参考） */
  nextSceneDescription?: string;
  /**
   * 同地点前镜的光线/色调基线（仅当本镜与上一镜 locationKey 相同时传入）。
   * 用于强制承接光线基调，防止同一地点相邻镜出现昼夜/冷暖漂移。
   */
  continuityLighting?: string;
  /**
   * 系列记忆上下文（既定场景/道具/角色状态，一句话预算级；系列续集时注入）。
   * 见 lib/series.ts#buildSeriesMemoryDigest（stage 'scene'）。
   */
  seriesContext?: string;
}
