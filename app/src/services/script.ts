/**
 * 剧本拆解服务
 * 将小说文本拆解为结构化的分镜脚本
 *
 * 兼容层：保留原有 parseScript / generateImagePrompt，
 * 新增 parseScriptWithAgent 供 workflow 外的调用方使用 Agent 能力
 */

import { chatCompletion } from "./ai";
import type { AIServiceConfig, SceneScript, ParsedScript } from "@/types";
import { SCRIPT_PARSE_SYSTEM, buildScriptParseUserPrompt } from "@/lib/prompts";
import { getSimpleStylePrefix } from "@/lib/prompts";
import { parseLooseJSON } from "@/lib/json-repair";
import { calibrateSceneDurations } from "@/lib/shot-timing";
import { ScriptParserAgent } from "./agents/script-parser-agent";
import type { WorkflowContext } from "./agents/types";

export type { SceneScript, ParsedScript };

export async function parseScript(
  text: string,
  config?: AIServiceConfig,
  seriesContext?: string
): Promise<ParsedScript> {
  const userPrompt = buildScriptParseUserPrompt(text, seriesContext);

  const response = await chatCompletion(
    [
      { role: "system", content: SCRIPT_PARSE_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.3, maxTokens: 8192, config }
  );

  // Hotfix 2026-05-20：用 parseLooseJSON 容错（处理 LLM 输出的智能引号 /
  // trailing comma / 注释 等不规范格式），失败由调用方接住
  const parsed = parseLooseJSON(response) as ParsedScript;

  // 时长校准（断裂 C 修复）：与 Agent 路径同源，把 LLM 的 duration 校准为对白
  // 驱动的确定值。防御式：scenes 缺失/非数组时原样返回。
  if (Array.isArray(parsed?.scenes)) {
    parsed.scenes = calibrateSceneDurations(parsed.scenes);
  }
  return parsed;
}

// 生成图像提示词
export function generateImagePrompt(
  scene: SceneScript,
  characters: Array<{ name: string; description: string }>,
  style: string = "anime"
): string {
  const stylePrefix = getSimpleStylePrefix(style);

  // 获取角色描述
  const characterDescriptions = scene.characters
    .map((name) => {
      const char = characters.find((c) => c.name === name);
      return char ? `${name}(${char.description})` : name;
    })
    .join(", ");

  const prompt = [
    stylePrefix,
    scene.description,
    characterDescriptions ? `characters: ${characterDescriptions}` : "",
    `shot type: ${scene.shotType}`,
    `mood: ${scene.emotion}`,
    "masterpiece, best quality",
  ]
    .filter(Boolean)
    .join(", ");

  return prompt;
}

/**
 * Agent 增强版剧本解析 — 使用 ScriptParserAgent（含 Zod 校验 + 自修复）
 * 可独立于 WorkflowEngine 使用，兼容旧调用方式
 */
export async function parseScriptWithAgent(
  text: string,
  config?: AIServiceConfig,
  seriesContext?: string
): Promise<ParsedScript> {
  const agent = new ScriptParserAgent();

  // 构造最小化 WorkflowContext
  const noop = () => {};
  const minimalCtx: WorkflowContext = {
    workflowRunId: "standalone",
    projectId: "",
    userId: "",
    config: {
      llm: config,
      mode: "auto",
      maxImageReflectionRounds: 0,
      style: "anime",
    },
    artifacts: {
      get: () => undefined,
      set: noop,
      getAll: () => [],
    },
    emit: noop,
  };

  const result = await agent.run({ text, seriesContext }, minimalCtx);

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Agent 剧本解析失败");
  }

  return result.data;
}
