/**
 * 集中类型导出
 */

// 项目
export type {
  Project,
  ProjectDetail,
  ProjectListItem,
  ProjectStatus,
  GenerationParams,
} from "./project";

// 场景
export type {
  Scene,
  ScenePreview,
  SceneScript,
  ParsedScript,
  GenerationStatus,
  ShotType,
  Emotion,
} from "./scene";

// 角色
export type {
  Character,
  CharacterListItem,
  CharacterTag,
  Tag,
  CharacterAppearance,
  ClothingPreset,
  CharacterReferenceAsset,
  CharacterFaceEmbedding,
  GenerationAttempt,
  CharacterInfo,
  CharacterAction,
  SceneAnalysis,
  AnalyzeSceneRequest,
} from "./character";

// AI 服务
export type {
  AIServiceConfig,
  AuthType,
  LLMMessage,
  LLMOptions,
  ImageGenerationOptions,
  VideoGenerationOptions,
  TTSOptions,
  AICategory,
  AIProviderProtocol,
} from "./ai";
