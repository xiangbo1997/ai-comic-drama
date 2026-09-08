/**
 * Step 1：剧本解析（从 `workflow-engine.ts#executeWorkflow` 的「Step 1」小节平移）
 *
 * 行为与拆分前逐字一致：加载系列 digest → ScriptParserAgent → 失败抛错 →
 * 写 artifact → 落库 Scene。
 */

import { ScriptParserAgent } from "../../script-parser-agent";
import { loadSeriesMemoryDigest } from "@/lib/series-memory";
import { executeAgentStep } from "../context";
import { saveScenesToProject } from "../scene-persistence";
import type { WorkflowContext, ScriptArtifact } from "../../types";

/**
 * 执行剧本解析步骤。
 *
 * 系列续集：注入既定设定 digest，解析结果不与前作矛盾（人物/世界观/伏笔）。
 * 非系列项目返回 null，对解析行为无影响。
 *
 * @throws 解析失败时抛错，由 executeWorkflow 的 catch 置 workflow 为 FAILED
 */
export async function runScriptStep(
  inputText: string,
  ctx: WorkflowContext
): Promise<ScriptArtifact> {
  const parseSeriesContext =
    (await loadSeriesMemoryDigest(ctx.projectId, "script")) ?? undefined;
  const scriptResult = await executeAgentStep(
    "parse_script",
    "script_parser",
    new ScriptParserAgent(),
    { text: inputText, seriesContext: parseSeriesContext },
    ctx
  );

  if (!scriptResult.success || !scriptResult.data) {
    throw new Error(scriptResult.error ?? "剧本解析失败");
  }

  const script = scriptResult.data as ScriptArtifact;
  ctx.artifacts.set({
    id: "script",
    type: "script",
    version: 1,
    data: script,
    createdBy: "script_parser",
    createdAt: new Date(),
  });

  // 保存场景到项目数据库
  await saveScenesToProject(ctx.projectId, script);

  return script;
}
