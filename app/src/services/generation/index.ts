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
export type { VideoDirectorInput, VideoDirection } from "./video-director";

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
