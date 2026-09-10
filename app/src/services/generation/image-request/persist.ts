/**
 * 图像生成的落库事务（分镜更新 + attempt + 任务完成 + 扣费）
 *
 * 从 api/generate/image/route.ts 原样提取（零行为变更）：事务边界、内部操作
 * 与顺序完全保持——scene.updateMany → attempt 计数/取消当前 → 逐张 create →
 * generationTask.update → chargeCredits，最后返回 candidates。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chargeCredits } from "@/lib/credits";
import { mergeSimilarityScores } from "@/services/generation";
import type { CandidateScore } from "@/services/generation";

/** 单张成功候选：已上传的图 URL + 编排器结果（策略 / 校验 / 重试次数） */
export interface PersistCandidate {
  imageUrl: string;
  result: {
    strategy: string;
    attemptCount: number;
    validation?: {
      passed?: boolean | null;
      faceCount?: number | null;
      reason?: string | null;
      /**
       * 一致性闸门是否真的执行过（"checked" | "skipped" | "error"）。
       * 必须落库：passed=true 可能只是「为不阻断出图而放行」，拿它当「质量已验证」
       * 会把跳过伪装成合格——这正是闸门此前空转却无人发现的原因。
       */
      status?: string | null;
      /** 三档判定（PASS / BORDERLINE / FAIL）；status!=="checked" 时为空 */
      grade?: string | null;
    } | null;
  };
}

/** 回传给客户端的候选项（前端据此渲染抽卡结果并点选切换版本） */
export interface PersistedCandidate {
  attemptId: string;
  imageUrl: string;
  vlmScore: number | null;
  recommended: boolean;
}

export interface PersistImageResultParams {
  taskId: string;
  userId: string;
  projectId: string | undefined;
  sceneId: string | undefined;
  /** 成功生成的候选（至少 1 张，调用方已过滤全失败情形） */
  successes: PersistCandidate[];
  /** 与 successes 逐项对齐的 VLM 分数 */
  scores: CandidateScore[];
  /** 推荐张在 successes 中的下标（写 Scene.imageUrl 的那张） */
  recommendedIdx: number;
  /** 推荐张的图 URL */
  imageUrl: string;
  /** 推荐张的编排器结果（output 的 strategy / attemptCount 取自它） */
  chosenResult: {
    strategy: string;
    attemptCount: number;
    warnings?: string[];
  };
  /**
   * 不阻断生成的中文告知（如「当前模型不支持参考图」），写进 task output 供
   * 客户端轮询后展示。能力错配是完全静默的失败，这是用户唯一能看见的信号（A1）。
   */
  warnings?: string[];
  /** 实际扣费额度（成功张数 × 单张实际成本） */
  actualCost: number;
  /** 生成所用 provider 协议与模型（落 attempt 便于溯源） */
  provider: string;
  model: string;
  /** 用户追加指令（空串表示无，落库为 null） */
  iterationNote: string;
}

/**
 * R1：将「任务完成 + 场景更新 + N 条 attempt + 扣费」包进同一事务，保证原子性。
 * chargeCredits 内部会在事务里再次校验余额并记录积分流水，
 * 余额不足会抛错并自动回滚本次写入。
 * R2：扣费时机为「生成成功后」，失败张从未被扣（按成功张数计），无需退款。
 */
export async function persistImageResult(
  params: PersistImageResultParams
): Promise<PersistedCandidate[]> {
  const {
    taskId,
    userId,
    projectId,
    sceneId,
    successes,
    scores,
    recommendedIdx,
    imageUrl,
    chosenResult,
    actualCost,
    provider,
    model,
    iterationNote,
    warnings,
  } = params;

  return prisma.$transaction(async (tx) => {
    const candidates: PersistedCandidate[] = [];

    // 如果有场景ID，更新场景为选中张 + 为每张候选落一条 GenerationAttempt。
    // 无 sceneId（罕见的无分镜生成）时不落 attempt（无版本历史意义），
    // 但仍返回候选（此时 attemptId 为空字符串占位，前端点选走 sceneId 分支）。
    if (projectId && sceneId) {
      await tx.scene.updateMany({
        where: { id: sceneId },
        data: { imageUrl, imageStatus: "COMPLETED" },
      });

      // 多候选：同分镜旧版本先取消 isCurrent；本次 N 张按顺序 attemptNumber 递增，
      // 仅「推荐张」置为当前版本（写 Scene.imageUrl 的那张）。
      const priorCount = await tx.generationAttempt.count({
        where: { sceneId },
      });
      await tx.generationAttempt.updateMany({
        where: { sceneId, isCurrent: true },
        data: { isCurrent: false },
      });

      for (let i = 0; i < successes.length; i++) {
        const c = successes[i];
        const isRecommended = i === recommendedIdx;
        // VLM 分数合并进 similarityScores（保留人脸校验等既有键，不整字段覆盖）
        const mergedScores = mergeSimilarityScores(
          {
            faceCount: c.result.validation?.faceCount ?? undefined,
            // 闸门执行状态与三档判定一并入 JSON 列（零 schema 变更），
            // 让「放行」与「验证通过」在数据层可区分
            identityStatus: c.result.validation?.status ?? undefined,
            identityGrade: c.result.validation?.grade ?? undefined,
          },
          scores[i]
        );
        const attempt = await tx.generationAttempt.create({
          data: {
            taskId,
            sceneId,
            attemptNumber: priorCount + 1 + i,
            provider,
            model,
            strategy: c.result.strategy,
            referenceAssetIds: [],
            note: iterationNote || null,
            outputUrl: c.imageUrl,
            similarityScores: mergedScores as Prisma.InputJsonValue,
            passedValidation: c.result.validation?.passed ?? null,
            faceCount: c.result.validation?.faceCount ?? null,
            failureReason: c.result.validation?.reason || null,
            // 推荐张即当前版本（写 Scene.imageUrl 的那张）
            isCurrent: isRecommended,
          },
        });
        candidates.push({
          attemptId: attempt.id,
          imageUrl: c.imageUrl,
          vlmScore: scores[i].vlmScore,
          recommended: isRecommended,
        });
      }
    } else {
      // 无分镜：仅回传候选列表（无 attempt 落库）
      for (let i = 0; i < successes.length; i++) {
        candidates.push({
          attemptId: "",
          imageUrl: successes[i].imageUrl,
          vlmScore: scores[i].vlmScore,
          recommended: i === recommendedIdx,
        });
      }
    }

    // 更新任务状态：output 保持向后兼容形状 + 追加 candidates
    await tx.generationTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        output: {
          imageUrl,
          cost: actualCost,
          strategy: chosenResult.strategy,
          attemptCount: chosenResult.attemptCount,
          // candidates 是具名接口数组，需显式转成 Prisma 的 Json 输入类型
          // （拆分前该对象为内联字面量，由 Prisma 自行推断）
          candidates: candidates as unknown as Prisma.InputJsonValue,
          // 能力错配等告知：轮询端点原样返回 output 作为 result，客户端据此提示用户
          ...(warnings && warnings.length > 0 ? { warnings } : {}),
        },
        completedAt: new Date(),
        cost: actualCost,
      },
    });

    // 扣减积分（按成功张数 × 单张成本，事务内扣费+记流水+余额校验）
    await chargeCredits(tx, {
      userId,
      amount: actualCost,
      type: "GENERATE_IMAGE",
      source: "generate:image",
      sourceId: taskId,
      note: sceneId
        ? `场景 ${sceneId} 图像生成（${successes.length} 张，策略 ${chosenResult.strategy}）`
        : `图像生成（${successes.length} 张，策略 ${chosenResult.strategy}）`,
    });

    return candidates;
  });
}
