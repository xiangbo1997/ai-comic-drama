/**
 * Step 2：角色圣经（从 `workflow-engine.ts#executeWorkflow` 的「Step 2」小节平移）
 *
 * 行为与拆分前逐字一致：CharacterBibleAgent → 闭环2 评审精炼 → 写 artifact →
 * 回写 Character 表（C1）→ 回填分镜角色锚点（C3）。
 */

import { CharacterBibleAgent } from "../../character-bible-agent";
import { persistCharacterBible } from "../../character-bible-persist";
import { executeAgentStep } from "../context";
import { backfillSelectedCharacterIds } from "../scene-persistence";
import { reviewAndRefineCharacterBible } from "./review";
import type {
  WorkflowContext,
  ScriptArtifact,
  CharacterBible,
} from "../../types";

/**
 * 执行角色圣经步骤。
 *
 * @throws 生成失败时抛错，由 executeWorkflow 的 catch 置 workflow 为 FAILED
 */
export async function runCharacterBibleStep(
  script: ScriptArtifact,
  ctx: WorkflowContext
): Promise<CharacterBible> {
  const bibleResult = await executeAgentStep(
    "build_character_bible",
    "character_bible",
    new CharacterBibleAgent(),
    { script },
    ctx
  );

  if (!bibleResult.success || !bibleResult.data) {
    throw new Error(bibleResult.error ?? "角色圣经生成失败");
  }

  let characterBible = bibleResult.data as CharacterBible;

  // ===== 闭环2：角色圣经质量评审（P3.5，纯函数评分，不达标可重生成一次） =====
  characterBible = await reviewAndRefineCharacterBible(
    script,
    characterBible,
    ctx
  );

  ctx.artifacts.set({
    id: "character_bible",
    type: "character_bible",
    version: 1,
    data: characterBible,
    createdBy: "character_bible",
    createdAt: new Date(),
  });

  // 角色圣经回写 Character 表（C1）：纯自动项目（用户未手建角色）此前只有 bible
  // artifact，出图阶段的 resolveProjectCharacters 从 DB 读角色读回空 → 画像/外貌全丢。
  // 这里把 bible 画像"只补空字段"地落库（命中已有角色不覆盖用户手改；未命中则建档 +
  // 关联），让自动路径出图能拿到真实角色数据。静默失败，绝不阻断后续步骤。
  await persistCharacterBible(ctx.projectId, characterBible);

  // C3 回填：saveScenesToProject 在 Step 1 已按当时项目角色算过 selectedCharacterId，
  // 但纯自动项目那时角色尚未建档（C1 在本步才回写），故对 selectedCharacterId 仍为空的
  // 分镜再匹配一次刚建档的角色补上。已有值的分镜不动（尊重手动路径/用户选择）。
  await backfillSelectedCharacterIds(ctx.projectId, script);

  return characterBible;
}
