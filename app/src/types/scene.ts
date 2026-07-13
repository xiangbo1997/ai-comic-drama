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
  /** 配音语速（0.5–2.0，默认 1.0），生成 TTS 时透传 provider */
  ttsSpeed?: number;
  /** 尾帧衔接下一镜：视频生成用下一镜图片做尾帧（FL 首尾帧插值），默认关 */
  videoLinkNext?: boolean;
  /** 镜头语言（LLM 脚本解析产出，喂给出图/视频 prompt） */
  cameraAngle?: string | null;
  lighting?: string | null;
  composition?: string | null;
  colorPalette?: string | null;
  cameraMovement?: string | null;
  /** 运动节拍：这一镜内"什么在动"（LLM 解析产出，喂视频 prompt） */
  actionBeat?: string | null;
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
  /** 运镜（喂给视频模型）: zoom_in/pan_left/tilt_up/static... */
  cameraMovement?: string;
  /** 运动节拍：这一镜内"什么在动"（中文，喂视频 prompt） */
  actionBeat?: string;
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

/**
 * 分镜的一个历史生成版本（迭代式图片生成）。
 *
 * 对应 Prisma 的 GenerationAttempt（按 sceneId 关联），但**不复用**
 * types/character.ts 里同名的角色域 GenerationAttempt——那是角色三视图域的
 * 前端类型，字段与语义不同。此处专供分镜版本历史 UI（SceneVersionStrip）。
 */
export interface SceneVersion {
  id: string;
  /** 该分镜第几版（1 起） */
  attemptNumber: number;
  /** 生成策略：prompt_only | reference_edit | face_id */
  strategy: string;
  /** 该版用户输入的追加指令（"改成夜晚"）；null=常规/首版 */
  note: string | null;
  /** 该版生成图 URL */
  outputUrl: string;
  /** 是否为当前选中版本 */
  isCurrent: boolean;
  /** 人脸一致性是否通过（无验证时 null） */
  passedValidation: boolean | null;
  /** VLM 择优分数（0–100）；多候选抽卡时有值，视觉不可用 / 单发时 null（批次 2 · 1.4） */
  vlmScore: number | null;
  createdAt: string;
}
