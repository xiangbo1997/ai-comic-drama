/**
 * Step 2：角色圣经（从 `workflow-engine.ts#executeWorkflow` 的「Step 2」小节平移）
 *
 * 行为与拆分前逐字一致：CharacterBibleAgent → 闭环2 评审精炼 → 写 artifact →
 * 回写 Character 表（C1）→ 回填分镜角色锚点（C3）。
 */

import { CharacterBibleAgent } from "../../character-bible-agent";
import {
  persistCharacterBible,
  assignProjectVoices,
} from "../../character-bible-persist";
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

  // 音色自动分配：此前角色没手动设音色就全部回落 provider 默认声线，典型成片是
  // 旁白一个磁性男声、**所有角色不分男女老少全是同一个甜美女声**——这是听感上
  // 最刺眼的 AI 破绽。这里在角色全部建档后统一分配一次（需项目级视野才能做到
  // 互斥），写回 Character.voiceId 作单一真源：两条配音路径都已在读这个字段，
  // 非空即生效，零改动受益。
  //
  // 幂等：只给 voiceId 为空的角色分配，已有音色（用户手选或上一集分配过）不动。
  // 系列剧跨集一致性天然成立——续集继承的是 ProjectCharacter 关联，指向同一条
  // Character 记录。静默失败，绝不阻断后续步骤。
  await assignProjectVoices(ctx.projectId);

  // C3 回填：saveScenesToProject 在 Step 1 已按当时项目角色算过 selectedCharacterId，
  // 但纯自动项目那时角色尚未建档（C1 在本步才回写），故对 selectedCharacterId 仍为空的
  // 分镜再匹配一次刚建档的角色补上。已有值的分镜不动（尊重手动路径/用户选择）。
  await backfillSelectedCharacterIds(ctx.projectId, script);

  return characterBible;
}
