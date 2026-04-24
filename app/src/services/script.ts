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
import { ScriptParserAgent } from "./agents/script-parser-agent";
import type {
  WorkflowConfig,
  WorkflowContext,
  ScriptArtifact,
} from "./agents/types";

export type { SceneScript, ParsedScript };

export async function parseScript(
  text: string,
  config?: AIServiceConfig
): Promise<ParsedScript> {
  const userPrompt = buildScriptParseUserPrompt(text);

  const response = await chatCompletion(
    [
      { role: "system", content: SCRIPT_PARSE_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.3, maxTokens: 8192, config }
  );

  // 提取 JSON
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse script response");
  }

  return JSON.parse(jsonMatch[0]) as ParsedScript;
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
  config?: AIServiceConfig
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

  const result = await agent.run({ text }, minimalCtx);

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Agent 剧本解析失败");
  }

  return result.data;
}
