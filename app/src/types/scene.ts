/**
 * 场景相关类型定义
 */

import type { HookType } from "./series-bible";

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
  /**
   * 节拍类型：impact(打击)/reveal(揭秘)/emotional(情绪)/calm(平静)——解析层克制标注。
   * 混合出片成本路由（lib/render-mode）据此判定该镜是否值得花钱生成视频。
   */
  beatType?: string | null;
  /** 高潮镜标记（每集 1-2 镜）：混合出片时高潮镜恒走视频生成 */
  isClimax?: boolean;
  /** 地点标签：同一物理地点的分镜共用同一短标签（LLM 解析产出，供场景锚定图分组） */
  locationKey?: string | null;
  /**
   * 分镜级换装标注（LLM 解析产出）：仅剧情明确非默认着装时出现。
   * 出图时据此按角色换成场景定妆照（换装变体），锁服装正确性。
   */
  characterOutfits?: Array<{ name: string; outfit: string }>;
  /**
   * 角色站位（180 度轴线）：{"角色名": "left" | "right" | "center"}。
   * 同一 locationKey 内不得跨镜翻转，否则角色左右位置随机互换、视线对不上。
   */
  screenSide?: Record<string, "left" | "right" | "center"> | null;
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
  /**
   * 编辑器使用：选中的角色详情（单角色分镜走此分支）。
   *
   * 字段必须与 `api/projects/[id]/route.ts` 的 selectedCharacter select 保持一致：
   * 漏声明字段不会被类型系统发现（消费方 collectCharacterRefs 的入参字段皆可选），
   * 只会在运行时静默拿到 undefined —— 三视图与定妆锚就此失效、人物出图不一致。
   */
  selectedCharacter?: {
    id: string;
    name: string;
    description?: string | null;
    gender?: string | null;
    age?: string | null;
    referenceImages: string[];
    /** 定妆锚权威字段，见 lib/character-finalized.ts */
    canonicalImageUrl?: string | null;
    /** 三视图等参考资产（pose: front/side/back） */
    referenceAssets?: {
      url: string;
      pose?: string | null;
      createdAt?: string;
    }[];
    /** 结构化外貌：deriveIdentityPrompt 拼身份前缀用，比自由文本 description 精确 */
    appearance?: {
      hairStyle?: string | null;
      hairColor?: string | null;
      faceShape?: string | null;
      eyeColor?: string | null;
      bodyType?: string | null;
      height?: string | null;
      skinTone?: string | null;
      accessories?: string | null;
      freeText?: string | null;
      // 美术工业一致性 6 项（与 api/projects/[id] 的 select 同步，漏声明不会被类型系统发现）
      defaultOutfit?: string | null;
      outfitDetails?: string | null;
      headToBodyRatio?: string | null;
      hairParting?: string | null;
      eyeHighlight?: string | null;
      asymmetry?: string | null;
    } | null;
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
  // 图片分镜默认 Ken Burns 运镜按导演运镜派生（预览端与导出端同构，走 lib/render-mode）
  | "cameraMovement"
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
  /** 地点标签：同一物理地点的分镜共用同一短标签（≤12 字），供场景锚定图分组 */
  locationKey?: string;
  /**
   * 叙事节拍类型：impact / reveal / emotional（解析层克制标注，常规镜省略）。
   * 解析 prompt 一直在产出该字段（见 prompts/script-parse.ts），此前类型未声明
   * 导致它在类型层被静默丢弃——全片节奏曲线要据它压缩高潮镜时长。
   */
  beatType?: string;
  /** 高潮镜标记（每集 1-2 镜，全集情绪顶点）：驱动节奏曲线的高潮段压缩 */
  isClimax?: boolean;
  /**
   * 尾帧衔接下一镜（可选）：与下一镜同地点且动作/时间连续时置 true，默认省略。
   * 落库映射到 Scene.videoLinkNext，供视频生成走 FL 首尾帧插值（计划 §5 · 2.1）。
   */
  linkNext?: boolean;
  /**
   * 分镜级换装标注：仅剧情明确要求某角色非默认着装（婚纱/战损/雨夜湿透/睡衣等）时出现。
   * 同一套衣服跨分镜用完全相同的短语（同 locationKey 纪律）；日常/默认着装省略。
   */
  characterOutfits?: Array<{ name: string; outfit: string }>;
  /**
   * 角色站位（180 度轴线）：{"角色名": "left" | "right" | "center"}。
   * 多人对话戏必填；同一 locationKey 内某角色的站位整场戏不得翻转，
   * 唯一例外是镜内实际走位换边（此时 description 须写明走位过程）。
   */
  screenSide?: Record<string, "left" | "right" | "center">;
}

/** 剧本解析完整结果 */
export interface ParsedScript {
  title: string;
  scenes: SceneScript[];
  characters: Array<{
    name: string;
    description: string;
  }>;
  /**
   * 本集结尾钩子类型（断点设计）。与创作路径 DramaScriptArtifact.hookType 同源，
   * 都取自 series-bible 的 HOOK_TYPES，供史官读取与钩子类型轮换。
   * 可选：老数据 / LLM 漏填时为 undefined。
   */
  hookType?: HookType;
  /** 一句话说明最后一镜停在什么未解决的张力上（≤40 字），供审片报告展示 */
  endingHook?: string;
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
