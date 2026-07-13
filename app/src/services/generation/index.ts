/**
 * Generation service barrel export
 */

export {
  orchestrateImageGeneration,
  hashStringToSeed,
} from "./image-orchestrator";
export type {
  OrchestratorRequest,
  OrchestratorResult,
  GenerationStrategy,
  ValidationResult,
} from "./image-orchestrator";

export { resolveStrategy } from "./strategy-resolver";
export { validateFaceConsistency } from "./face-validator";

export {
  buildDirectorPrompt,
  parseDirectorResponse,
  directVideoScene,
} from "./video-director";
export type {
  VideoDirectorInput,
  VideoDirection,
  VariationType,
} from "./video-director";

// 镜内首尾帧分解（包 B）：尾帧图生成器 + 裁决纯函数
export {
  generateIntraShotTailFrame,
  shouldGenerateTailFrame,
} from "./tail-frame";
export type { GenerateTailFrameArgs } from "./tail-frame";

// 场景定妆照（换装变体）：换装定妆照解析器 + 匹配/规整纯函数
export {
  resolveCharacterLookUrl,
  matchClothingPreset,
  normalizeOutfitKey,
} from "./character-look";
export type {
  ResolveCharacterLookArgs,
  LookClothingPreset,
} from "./character-look";

// 分镜换装接入层：编排器据分镜换装标注解析每角色换装定妆照 + 解析/匹配纯函数
export {
  resolveSceneCharacterLooks,
  parseOutfitEntries,
  matchOutfitToCharacter,
} from "./scene-looks";
export type {
  SceneLookResult,
  ResolveSceneLooksArgs,
  OutfitEntry,
} from "./scene-looks";

export {
  planVideoSegments,
  estimateVideoCost,
  nearestVideoDuration,
  clampSceneDuration,
  MAX_SCENE_DURATION,
  MIN_SCENE_DURATION,
} from "./video-segmenter";
export type { VideoSegmentPlan, VideoSegmentPlanItem } from "./video-segmenter";

export { generateSceneVideoSegmented } from "./segmented-video";
export type {
  SegmentedVideoArgs,
  SegmentedVideoResult,
} from "./segmented-video";

export type {
  SceneCharacterInfo,
  CharacterRole,
  StrategyDecision,
} from "./types";

// 多候选抽卡 · 择优（批次 2 · 1.4）
export {
  ALLOWED_CANDIDATE_COUNTS,
  normalizeCandidateCount,
  pickRecommendedIndex,
  mergeSimilarityScores,
} from "./candidate-selection";
export type { CandidateCount, CandidateScore } from "./candidate-selection";
export { scoreCandidate } from "./candidate-scorer";
export type { CandidateScoreContext } from "./candidate-scorer";
