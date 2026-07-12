/**
 * Prompt 模板集中导出
 */

export {
  SCRIPT_PARSE_SYSTEM,
  buildScriptParseUserPrompt,
} from "./script-parse";
export {
  getStylePrefix,
  getShotTypeDescription,
  getSimpleStylePrefix,
  getLightingPrefix,
  buildConsistencyGuard,
} from "./image-prompt";
export {
  getNegativePromptPreset,
  getNegativeBaseline,
  getSceneNegativePrompt,
} from "./negative-prompts";
export type { NegativePromptPreset } from "./negative-prompts";
export {
  buildVideoScenePrompt,
  describeCameraMovement,
  CAMERA_MOVEMENTS,
} from "./video-prompt";
export type { VideoScenePromptInput, CameraMovement } from "./video-prompt";
export {
  EPISODE_HOOK_RULES,
  EPISODE_PACING_RULES,
  EPISODE_ENDING_RULES,
  SHOT_RHYTHM_RULES,
  buildEpisodeStructureBlock,
} from "./episode-structure";
export {
  EXTERNALIZATION_RULES,
  NARRATION_DISCIPLINE_RULES,
  buildAdaptationBlock,
} from "./adaptation-rules";
