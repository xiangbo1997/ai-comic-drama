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
