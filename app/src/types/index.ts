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
  ProducerReview,
  ProducerReviewConfirmed,
} from "./project";

// 系列（多集漫剧）
export type {
  SeriesSummary,
  SeriesEpisodeRef,
  ProjectSeriesInfo,
  SeriesBibleSummary,
} from "./series";

// 系列故事圣经（跨集永久记忆）
export type {
  SeriesStoryBible,
  WorldSetting,
  BibleLocation,
  BibleProp,
  BibleCharacter,
  BibleThread,
  BibleEpisode,
  HookType,
  ThreadStatus,
} from "./series-bible";
export {
  parseStoryBible,
  isBibleEmpty,
  emptyBible,
  HOOK_TYPES,
  THREAD_STATUSES,
} from "./series-bible";

// 场景
export type {
  Scene,
  ScenePreview,
  SceneScript,
  ParsedScript,
  SceneVersion,
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

// 短剧创作工作流
export type {
  DramaScriptInput,
  DramaSceneScript,
  DramaScriptArtifact,
  StoryboardCell,
  StoryboardTableArtifact,
} from "./drama";

// 导出样式（字幕 + 水印）
export type { SubtitleStyle, Watermark } from "./export-style";
export { DEFAULT_SUBTITLE_STYLE, DEFAULT_WATERMARK } from "./export-style";
