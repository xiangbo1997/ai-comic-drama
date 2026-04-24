/**
 * 场景相关类型定义
 */

/** 生成状态 — 与 Prisma enum GenerationStatus 对齐 */
export type GenerationStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

/** 镜头类型 */
export type ShotType = "特写" | "近景" | "中景" | "全景" | "远景";

/** 情绪类型 */
export type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "fear";

/** 场景数据 */
export interface Scene {
  id: string;
  order: number;
  shotType: string | null;
  description: string;
  dialogue: string | null;
  narration: string | null;
  emotion: string | null;
  duration: number;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  imageStatus: GenerationStatus;
  videoStatus: GenerationStatus;
  audioStatus: GenerationStatus;
  /** 编辑器使用：选中的角色 ID */
  selectedCharacterId?: string | null;
  /** 编辑器使用：选中的多个角色 ID */
  selectedCharacterIds?: string[];
  /** 编辑器使用：选中的角色详情 */
  selectedCharacter?: {
    id: string;
    name: string;
    referenceImages: string[];
  } | null;
}

/** 时间线/预览用的精简场景 */
export type ScenePreview = Pick<
  Scene,
  | "id"
  | "order"
  | "duration"
  | "imageUrl"
  | "videoUrl"
  | "audioUrl"
  | "dialogue"
  | "narration"
>;

/** 剧本解析结果中的场景 */
export interface SceneScript {
  id: number;
  shotType: string;
  description: string;
  characters: string[];
  dialogue: string | null;
  narration: string | null;
  emotion: string;
  duration: number;
  /** Stage 1.8：镜头语言字段（LLM 可选输出；消费方按需使用） */
  cameraAngle?: string;
  lighting?: string;
  composition?: string;
  colorPalette?: string;
}

/** 剧本解析完整结果 */
export interface ParsedScript {
  title: string;
  scenes: SceneScript[];
  characters: Array<{
    name: string;
    description: string;
  }>;
}
