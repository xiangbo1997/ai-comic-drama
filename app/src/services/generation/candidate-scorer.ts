/**
 * 候选图 VLM 打分器（批次 2 · 1.4）
 *
 * 对多候选抽卡的每张成功候选跑一次视觉评审，产出 0–100 综合分与理由，
 * 供 candidate-selection 挑「推荐」张。
 *
 * 复用 services/agents/vision-reviewer 的 reviewImageWithVision（OpenAI 兼容多模态端点）：
 * - 视觉不可用（无 LLM config / claude/gemini 协议 / HTTP 失败 / 解析失败）→ 返回 null 分数，
 *   绝不抛错阻断出图（降级不阻断，与 observer-agent 同款容错）。
 *
 * 设计取舍：本模块只负责「打一张图的分」，并行度与顺序由调用方（route）控制。
 */

import type { AIServiceConfig } from "@/types";
import { reviewImageWithVision } from "@/services/agents/vision-reviewer";
import { createLogger } from "@/lib/logger";
import type { CandidateScore } from "./candidate-selection";

const log = createLogger("services:generation:candidate-scorer");

/** 打分上下文（分镜维度或角色维度都可用同一形状描述） */
export interface CandidateScoreContext {
  imageUrl: string;
  /** 场景 / 角色描述（分镜用画面描述；角色用外貌描述） */
  sceneDescription: string;
  /** 角色标准外貌（分镜维度传角色，角色维度可传角色自身描述） */
  characterDescriptions: string;
  /** 期望情绪（分镜维度）；角色维度传 "neutral" */
  expectedEmotion: string;
  /** 期望景别（分镜维度）；角色维度传单人立绘约定 */
  expectedShotType: string;
  /** 全片统一主色板（可选） */
  expectedPalette?: string;
}

/**
 * 对单张候选图打分。视觉不可用 / 任何失败 → 返回 { vlmScore: null }（降级不阻断）。
 *
 * @param ctx 打分上下文
 * @param llmConfig 用户 LLM 配置；null / undefined 时直接降级（不打分）
 */
export async function scoreCandidate(
  ctx: CandidateScoreContext,
  llmConfig: AIServiceConfig | null | undefined
): Promise<CandidateScore> {
  if (!llmConfig) {
    return { vlmScore: null, vlmReason: null };
  }

  try {
    const verdict = await reviewImageWithVision({
      imageUrl: ctx.imageUrl,
      sceneDescription: ctx.sceneDescription,
      characterDescriptions: ctx.characterDescriptions,
      expectedEmotion: ctx.expectedEmotion,
      expectedShotType: ctx.expectedShotType,
      expectedPalette: ctx.expectedPalette,
      llmConfig,
    });
    // reviewImageWithVision 返回 ObserverVerdict：取 5 维综合分 score.overall
    const overall = verdict.score?.overall;
    if (typeof overall !== "number" || Number.isNaN(overall)) {
      return { vlmScore: null, vlmReason: null };
    }
    // 收窄到 0–100 整数，避免脏数据进 DB
    const clamped = Math.round(Math.min(100, Math.max(0, overall)));
    const reason = verdict.score?.feedback?.trim() || null;
    return { vlmScore: clamped, vlmReason: reason };
  } catch (err) {
    // 打分失败静默降级：不影响出图，仅记日志
    log.warn(
      `Candidate scoring failed, degrade to no-score: ${
        err instanceof Error ? err.message : "Unknown"
      }`
    );
    return { vlmScore: null, vlmReason: null };
  }
}
