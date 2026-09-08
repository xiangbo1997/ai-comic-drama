/**
 * Workflow 共享执行上下文工具
 *
 * 从 `workflow-engine.ts` 平移（纯搬运，无行为变更）：
 * - `log`：workflow 全域唯一 logger 实例（各 step 模块 import 同一个，勿各自新建）
 * - `executeAgentStep`：执行单个 Agent 步骤并持久化 WorkflowStepRun 状态
 * - `setReviewArtifact`：把评审结果写入 artifacts（随 WorkflowRun.artifacts 落库）
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { emitEvent } from "../event-bus";
import type {
  WorkflowContext,
  WorkflowStep,
  ReviewArtifactData,
} from "../types";

/**
 * workflow 全域 logger（单例）。
 *
 * 名称保持 "workflow-engine" 不变：日志检索/告警规则按此前缀匹配，改名会静默失效。
 */
export const log = createLogger("workflow-engine");

/** 执行单个 Agent 步骤，持久化状态 */
export async function executeAgentStep<TInput, TOutput>(
  step: WorkflowStep,
  agentName: string,
  agent: {
    run: (
      input: TInput,
      ctx: WorkflowContext
    ) => Promise<{
      success: boolean;
      data?: TOutput;
      error?: string;
      reasoning?: string;
      attempts: number;
      tokensUsed: number;
    }>;
  },
  input: TInput,
  ctx: WorkflowContext
): Promise<{
  success: boolean;
  data?: TOutput;
  error?: string;
  reasoning?: string;
  attempts: number;
  tokensUsed: number;
}> {
  // 更新当前步骤
  await prisma.workflowRun.update({
    where: { id: ctx.workflowRunId },
    data: { currentStep: step },
  });

  const stepRun = await prisma.workflowStepRun.create({
    data: {
      workflowRunId: ctx.workflowRunId,
      step,
      agentName,
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const result = await agent.run(input, ctx);

    await prisma.workflowStepRun.update({
      where: { id: stepRun.id },
      data: {
        status: result.success ? "completed" : "failed",
        output: result.data
          ? (JSON.parse(JSON.stringify(result.data)) as Prisma.InputJsonValue)
          : undefined,
        reasoning: result.reasoning,
        attempts: result.attempts,
        tokensUsed: result.tokensUsed,
        error: result.error,
        completedAt: new Date(),
      },
    });

    emitEvent({
      type: result.success ? "step:completed" : "step:failed",
      workflowRunId: ctx.workflowRunId,
      step,
      data: {
        reasoning: result.reasoning,
        attempts: result.attempts,
      },
      timestamp: new Date(),
    });

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown";
    await prisma.workflowStepRun.update({
      where: { id: stepRun.id },
      data: { status: "failed", error: errorMsg, completedAt: new Date() },
    });
    return { success: false, error: errorMsg, attempts: 1, tokensUsed: 0 };
  }
}

/**
 * C6：把评审结果写入 artifacts（key = review:<id>），随 WorkflowRun.artifacts 持久化。
 * 与 emitEvent 并行——事件走 SSE 实时推送但不落库，artifact 落库供刷新后仍可展示。
 */
export function setReviewArtifact(
  ctx: WorkflowContext,
  id: "characterBible" | "storyboard" | "videoCoherence",
  data: ReviewArtifactData
): void {
  ctx.artifacts.set({
    id,
    type: "review",
    version: 1,
    data,
    createdBy: "closed_loop_review",
    createdAt: new Date(),
  });
}
