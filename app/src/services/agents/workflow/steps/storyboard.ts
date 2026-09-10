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

  // ===== 闭环3：叙事连贯评审 + 反思重生成（真闭环，默认开启） =====
  // 评审不达标时把六维评语回注 prompt 重生成整套分镜，返回最优版本；
  // 评审不可用/异常时原样返回入参，不阻断主流程。
  const reviewed = await reviewStoryboardCoherence(
    storyboard,
    script,
    characterBible,
    ctx
  );

  // artifact 写「评审后的定稿版」——后续出图/出视频全部读这份 artifact，
  // 若仍写评审前的版本，闭环修订就只是一份评分记录，等于没落地。
  ctx.artifacts.set({
    id: "storyboard",
    type: "storyboard",
    version: 1,
    data: reviewed,
    createdBy: "storyboard",
    createdAt: new Date(),
  });

  return reviewed;
}
