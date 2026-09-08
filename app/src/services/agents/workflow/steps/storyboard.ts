/**
 * Step 3：分镜补全（从 `workflow-engine.ts#executeWorkflow` 的「Step 3」小节平移）
 *
 * 行为与拆分前逐字一致：StoryboardAgent → 失败抛错 → 写 artifact → 闭环3 叙事连贯评审。
 */

import { StoryboardAgent } from "../../storyboard-agent";
import { executeAgentStep } from "../context";
import { reviewStoryboardCoherence } from "./review";
import type {
  WorkflowContext,
  ScriptArtifact,
  CharacterBible,
  StoryboardArtifact,
} from "../../types";

/**
 * 执行分镜补全步骤。
 *
 * @throws 补全失败时抛错，由 executeWorkflow 的 catch 置 workflow 为 FAILED
 */
export async function runStoryboardStep(
  script: ScriptArtifact,
  characterBible: CharacterBible,
  ctx: WorkflowContext
): Promise<StoryboardArtifact> {
  const storyboardResult = await executeAgentStep(
    "build_storyboard",
    "storyboard",
    new StoryboardAgent(),
    { script, characterBible },
    ctx
  );

  if (!storyboardResult.success || !storyboardResult.data) {
    throw new Error(storyboardResult.error ?? "分镜补全失败");
  }

  const storyboard = storyboardResult.data as StoryboardArtifact;
  ctx.artifacts.set({
    id: "storyboard",
    type: "storyboard",
    version: 1,
    data: storyboard,
    createdBy: "storyboard",
    createdAt: new Date(),
  });

  // ===== 闭环3：叙事连贯评审（P3.5，默认关闭，开启后评分并记录） =====
  await reviewStoryboardCoherence(storyboard, ctx);

  return storyboard;
}
