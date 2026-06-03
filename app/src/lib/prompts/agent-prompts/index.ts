/**
 * Agent Prompt 模板集中导出
 */

export {
  SCRIPT_PARSER_SYSTEM,
  buildScriptParserUserPrompt,
  buildScriptParserRepairPrompt,
} from "./script-parser";

export {
  DRAMA_SCRIPT_SYSTEM,
  buildDramaScriptUserPrompt,
  buildDramaScriptRepairPrompt,
} from "./drama-script";

export {
  STORYBOARD_TABLE_SYSTEM,
  buildStoryboardTableUserPrompt,
  buildStoryboardTableRepairPrompt,
} from "./storyboard-table";

export {
  CHARACTER_BIBLE_SYSTEM,
  buildCharacterBiblePrompt,
} from "./character-bible";

export { STORYBOARD_SYSTEM, buildStoryboardPrompt } from "./storyboard";

export { OBSERVER_SYSTEM, buildImageReviewPrompt } from "./observer";

export { REFLECTION_SYSTEM, buildReflectionPrompt } from "./reflection";

export {
  STORYBOARD_REVIEW_SYSTEM,
  buildStoryboardReviewPrompt,
  VIDEO_REVIEW_SYSTEM,
  buildVideoReviewPrompt,
} from "./narrative-review";
export type { SceneSummary, VideoSceneSummary } from "./narrative-review";
