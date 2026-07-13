/**
 * Prompt 模板集中导出
 */

export {
  SCRIPT_PARSE_SYSTEM,
  buildScriptParseUserPrompt,
  buildEventMapBlock,
} from "./script-parse";
export {
  getStylePrefix,
  getShotTypeDescription,
  getSimpleStylePrefix,
  getLightingPrefix,
  buildConsistencyGuard,
} from "./image-prompt";
export {
  STYLE_PACKS,
  STYLE_PACK_OPTIONS,
  getStylePack,
  getStylePaletteBaseline,
} from "./style-packs";
export type { StylePack, StylePackOption } from "./style-packs";
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
  EPISODE_CONFLICT_RULES,
  SHOT_RHYTHM_RULES,
  buildEpisodeStructureBlock,
} from "./episode-structure";
export {
  EXTERNALIZATION_RULES,
  NARRATION_DISCIPLINE_RULES,
  buildAdaptationBlock,
} from "./adaptation-rules";
export { PROMPT_FIDELITY_RULES } from "./prompt-fidelity";
export {
  WORLDVIEW_DRAFT_SYSTEM,
  buildWorldviewDraftPrompt,
} from "./worldview-draft";
export type { WorldviewDraftInput } from "./worldview-draft";
export {
  APPEARANCE_PRESETS,
  APPEARANCE_DRAFT_SYSTEM,
  buildAppearanceDraftPrompt,
} from "./appearance-draft";
export type { AppearanceDraftInput } from "./appearance-draft";
export {
  PROMPT_SUGGEST_SYSTEM,
  buildPromptSuggestPrompt,
} from "./prompt-suggest";
export type {
  PromptSuggestContext,
  PromptSuggestInput,
  PromptSuggestCharacter,
  PromptSuggestScene,
} from "./prompt-suggest";
