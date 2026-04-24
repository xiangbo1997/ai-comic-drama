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
}

/** 角色列表项（角色管理页使用，含额外字段） */
export interface CharacterListItem extends Character {
  voiceProvider: string | null;
  createdAt: string;
  tags?: CharacterTag[];
  appearance?: CharacterAppearance | null;
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
}
