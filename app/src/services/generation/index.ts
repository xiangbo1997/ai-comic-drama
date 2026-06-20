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

export type {
  SceneCharacterInfo,
  CharacterRole,
  StrategyDecision,
} from "./types";
