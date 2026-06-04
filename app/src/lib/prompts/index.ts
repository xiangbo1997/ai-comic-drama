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
