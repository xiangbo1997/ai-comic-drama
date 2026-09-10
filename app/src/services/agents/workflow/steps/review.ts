/**
 * 闭环评审步骤（从 `workflow-engine.ts` 的闭环 2 / 3 / 4 小节平移，纯搬运无行为变更）
 *
 * - 闭环2：角色圣经质量评审 + 反思重生成（真闭环，可重生成）
 * - 闭环3：叙事连贯评审 + 反思重生成（真闭环，可重生成）
 * - 闭环4：视频连贯评审（只评分）
 */

import { CharacterBibleAgent } from "../../character-bible-agent";
import { StoryboardAgent } from "../../storyboard-agent";
import {
  reviewStoryboard,
  reviewVideoSequence,
} from "../../narrative-observer";
import { reviewCharacterBible } from "../../character-bible-observer";
import { resolvePolicyAsync, runClosedLoop } from "../../closed-loop";
import { emitEvent } from "../../event-bus";
import { log, setReviewArtifact } from "../context";
import type {
  WorkflowContext,
  ScriptArtifact,
  CharacterBible,
  StoryboardArtifact,
} from "../../types";

/**
 * 闭环2：角色圣经质量评审 + 反思重生成 (P3.5)。
 *
 * 用 runClosedLoop 实现真闭环：CharacterBibleAgent 生成 → reviewCharacterBible
 * 纯函数评分 → 不达标则带 suggestions 重生成。默认关闭时直接返回原圣经。
 * maxRounds 由 policy 控制（默认 2），防止重生成失控。
 *
 * @returns 最优的角色圣经（通过评审的，或历史最高分的；闭环关闭时为原值）
 */
export async function reviewAndRefineCharacterBible(
  script: ScriptArtifact,
  bible: CharacterBible,
  ctx: WorkflowContext
): Promise<CharacterBible> {
  const policy = await resolvePolicyAsync(ctx, "characterBible");
  if (!policy.enabled) return bible;

  const agent = new CharacterBibleAgent();

  const result = await runClosedLoop<{ refinement: string }, CharacterBible>(
    {
      initialState: { refinement: "" },
      maxRounds: policy.maxRounds,
      workflowStep: "review_character_bible",
      taskLabel: "正在评审角色圣经质量",
      // 首轮直接用已生成的 bible；重试轮带 refinement 重新生成
      generate: async (state, history) => {
        if (history.length === 0) return bible;
        const res = await agent.run(
          {
            script,
            // 把上一轮建议作为额外约束传入（CharacterBibleAgent 通过 script 上下文重生成）
            existingCharacters: undefined,
          },
          ctx
        );
        return (res.data as CharacterBible) ?? bible;
      },
      // 纯函数评审，零成本
      evaluate: async (candidate) => reviewCharacterBible(candidate),
      // 反思：累积建议（CharacterBibleAgent 重生成时会读 script 重新发挥）
      reflect: async (state, verdict) => ({
        refinement: [state.refinement, ...verdict.suggestions]
          .filter(Boolean)
          .join("\n"),
      }),
    },
    ctx
  );

  emitEvent({
    type: "step:completed",
    workflowRunId: ctx.workflowRunId,
    step: "review_character_bible",
    data: {
      passed: result.passed,
      score: result.bestScore,
      rounds: result.rounds,
      passThreshold: policy.passThreshold,
    },
    timestamp: new Date(),
  });

  // C6：评审结果持久化到 artifacts（随 WorkflowRun.artifacts 序列化，SSE 事件会随流丢失）。
  // WorkflowPanel 读到 review:* artifact 时渲染「质量评审」小节。
  setReviewArtifact(ctx, "characterBible", {
    label: "角色圣经",
    score: result.bestScore,
    pass: result.passed,
    passThreshold: policy.passThreshold,
    suggestions: [],
  });

  log.info(
    `Character bible review: score=${result.bestScore}, passed=${result.passed}, rounds=${result.rounds}`
  );

  return result.best ?? bible;
}

/**
 * 闭环3：叙事连贯评审 + 反思重生成（真闭环）。
 *
 * 与闭环2 同构（runClosedLoop）：StoryboardAgent 产出分镜 → reviewStoryboard 从
 * 导演视角六维打分（开场钩子/结尾钩子/外化质量/叙事连贯/角色连续/镜头多样）→
 * 不达标则把 verdict.suggestions 作为修订约束回注 prompt 重生成整套分镜。
 *
 * 与闭环2 的差异：评分函数是 LLM 调用（非纯函数），故每轮多一次纯文本 LLM 调用。
 * 但这点开销相对于后续几十张图 + 几十段视频可以忽略，而一份「开场铺垫、
 * 旁白复述心理、结尾把故事讲完」的分镜会让后面所有生成开销全部白费。
 *
 * maxRounds 默认 1（policy 控制）：一次修订足够，控制成本与用户等待时延。
 *
 * 降级优先：评审 LLM 不可用/超时/返回非法 JSON 时 reviewStoryboard 返回 null，
 * runClosedLoop 按 acceptOnEvalFailure=true 接受当前分镜；重生成异常也只是 break，
 * 最终 `result.best ?? storyboard` 保证永远返回一份可用分镜，绝不阻断主流程。
 *
 * @returns 修订后的分镜（通过评审的，或历史最高分的；闭环关闭/评审失败时为原值）
 */
export async function reviewStoryboardCoherence(
  storyboard: StoryboardArtifact,
  script: ScriptArtifact,
  characterBible: CharacterBible,
  ctx: WorkflowContext
): Promise<StoryboardArtifact> {
  const policy = await resolvePolicyAsync(ctx, "storyboard");
  if (!policy.enabled) return storyboard;

  const agent = new StoryboardAgent();

  const result = await runClosedLoop<
    { refinement: string },
    StoryboardArtifact
  >(
    {
      initialState: { refinement: "" },
      maxRounds: policy.maxRounds,
      workflowStep: "review_storyboard",
      taskLabel: "正在评审分镜叙事质量",
      // 首轮直接用已生成的分镜（不重复付费）；重试轮带 refinement 重新生成整套
      generate: async (state, history) => {
        if (history.length === 0) return storyboard;
        const res = await agent.run(
          { script, characterBible, refinement: state.refinement },
          ctx
        );
        return (res.data as StoryboardArtifact) ?? storyboard;
      },
      evaluate: async (candidate) =>
        reviewStoryboard(
          candidate.scenes.map((s) => ({
            id: s.id,
            shotType: s.shotType,
            emotion: s.emotion,
            characters: s.characters,
            description: s.description,
          })),
          ctx
        ),
      // 反思：累积各轮建议作为修订约束（history 已含本轮，跨轮记忆避免重复犯错）
      reflect: async (state, verdict) => ({
        refinement: [state.refinement, ...verdict.suggestions]
          .filter(Boolean)
          .join("\n"),
      }),
    },
    ctx
  );

  // 末轮 verdict（无评审记录时为空——评审 LLM 全程不可用）
  const lastVerdict = result.history.at(-1)?.verdict;

  emitEvent({
    type: "step:completed",
    workflowRunId: ctx.workflowRunId,
    step: "review_storyboard",
    data: {
      pass: result.passed,
      score: result.bestScore,
      rounds: result.rounds,
      passThreshold: policy.passThreshold,
      feedback: lastVerdict?.score.feedback,
      suggestions: lastVerdict?.suggestions ?? [],
    },
    timestamp: new Date(),
  });

  // C6：评审结果持久化到 artifacts（供 WorkflowPanel 与审片报告「叙事质量」节消费）。
  // dimensions 六维一并落库：只给总分无法定位是哪一维拖了后腿。
  setReviewArtifact(ctx, "storyboard", {
    label: "分镜连贯",
    score: result.bestScore,
    pass: result.passed,
    passThreshold: policy.passThreshold,
    suggestions: lastVerdict?.suggestions ?? [],
    feedback: lastVerdict?.score.feedback,
    dimensions: lastVerdict?.score.dimensions,
    rounds: result.rounds,
  });

  log.info(
    `Storyboard narrative review: score=${result.bestScore}, passed=${result.passed}, rounds=${result.rounds}`
  );

  return result.best ?? storyboard;
}

/**
 * 闭环4：视频连贯评审 (P3.5)。
 *
 * 默认关闭（采数据模式）。开启后从剪辑师视角评审视频镜头序列的衔接连贯
 * （转场流畅/运动连续/节奏），把评分通过 SSE 记录。
 *
 * 当前只评分不重生成（视频重生成成本最高，待数据验证后再开启完整闭环）。
 */
export async function reviewVideoCoherence(
  storyboard: StoryboardArtifact,
  ctx: WorkflowContext
): Promise<void> {
  const policy = await resolvePolicyAsync(ctx, "videoCoherence");
  if (!policy.enabled) return;

  const summaries = storyboard.scenes.map((s) => ({
    id: s.id,
    shotType: s.shotType,
    duration: s.duration,
    cameraMovement: s.cameraMovement,
    transition: s.transition,
    description: s.description,
  }));

  const verdict = await reviewVideoSequence(summaries, ctx);
  if (!verdict) return;

  emitEvent({
    type: "step:completed",
    workflowRunId: ctx.workflowRunId,
    step: "review_videos",
    data: {
      pass: verdict.pass,
      score: verdict.score.overall,
      passThreshold: policy.passThreshold,
      feedback: verdict.score.feedback,
      suggestions: verdict.suggestions,
    },
    timestamp: new Date(),
  });

  // C6：评审结果持久化到 artifacts
  setReviewArtifact(ctx, "videoCoherence", {
    label: "视频连贯",
    score: verdict.score.overall,
    pass: verdict.pass,
    passThreshold: policy.passThreshold,
    suggestions: verdict.suggestions,
    feedback: verdict.score.feedback,
  });

  log.info(
    `Video coherence review: score=${verdict.score.overall}, pass=${verdict.pass}`
  );
}
