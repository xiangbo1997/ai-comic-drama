/**
 * Workflow 逐项扣费（从 `workflow-engine.ts` 平移，纯搬运无行为变更）
 */

import { prisma } from "@/lib/prisma";
import {
  chargeCredits,
  InsufficientCreditsError,
  type ChargeType,
} from "@/lib/credits";
import { log } from "./context";
import type { WorkflowContext } from "../types";

/** 扣费种类 → 积分流水类型的固定映射 */
const CHARGE_TYPE_MAP: Record<WorkflowChargeKind, ChargeType> = {
  image: "GENERATE_IMAGE",
  video: "GENERATE_VIDEO",
  tts: "GENERATE_TTS",
};

export type WorkflowChargeKind = "image" | "video" | "tts";

/**
 * 幂等键构造：`wf:{runId}:{sceneId}:{kind}`。
 *
 * 提取为独立纯函数，便于单测锁定格式——格式一旦漂移，历史流水的幂等判定会失效，
 * workflow 重跑会对同一场景重复扣费。
 */
export function buildWorkflowChargeSourceId(
  workflowRunId: string,
  sceneId: string,
  kind: WorkflowChargeKind
): string {
  return `wf:${workflowRunId}:${sceneId}:${kind}`;
}

/**
 * Workflow 逐项扣费
 *
 * 此前 workflow（自动路径）全程不扣费，仅在入口有 10 积分门槛，导致
 * 「一键自动生成」比手动逐步生成便宜 10-100×，构成白嫖漏洞。这里把每个
 * 产出项的扣费收口到 lib/credits.chargeCredits，与手动路径
 * （generate/image/route.ts）的扣费模型对齐。
 *
 * - 时机：产物成功落库后扣费（失败项不扣，无需退款）
 * - 幂等：sourceId = `wf:{runId}:{sceneId}:{kind}`，防 workflow 重跑对同
 *   场景重复扣费
 * - 失败不阻断：余额在生成期间被扣空时只记录警告，不回滚已交付产物
 */
export async function chargeWorkflowItem(
  ctx: WorkflowContext,
  p: {
    sceneId: string;
    kind: WorkflowChargeKind;
    amount: number;
    note: string;
  }
): Promise<void> {
  if (p.amount <= 0) return;
  const typeMap = CHARGE_TYPE_MAP;
  const sourceId = buildWorkflowChargeSourceId(
    ctx.workflowRunId,
    p.sceneId,
    p.kind
  );
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.creditTransaction.findFirst({
        where: { userId: ctx.userId, sourceId, type: typeMap[p.kind] },
        select: { id: true },
      });
      if (existing) return; // 幂等
      await chargeCredits(tx, {
        userId: ctx.userId,
        amount: p.amount,
        type: typeMap[p.kind],
        source: "workflow:auto",
        sourceId,
        note: p.note,
      });
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      log.warn(
        `[workflow charge] ${sourceId} 余额不足（需 ${p.amount}，余 ${error.available}），产物已交付，本次让利`
      );
    } else {
      log.error(`[workflow charge] ${sourceId} 扣费异常（产物已交付）`, error);
    }
  }
}
