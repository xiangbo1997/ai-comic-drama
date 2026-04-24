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
} from "./image-prompt";
export {
  getNegativePromptPreset,
  getNegativeBaseline,
} from "./negative-prompts";
export type { NegativePromptPreset } from "./negative-prompts";
