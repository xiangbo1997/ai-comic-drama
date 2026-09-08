/**
 * WorkflowEngine — 管线执行引擎
 * Hybrid Plan-and-Execute 的核心调度器
 *
 * Stage 3.3：单文件从 ~745 行拆分为：
 * - `./artifact-store.ts` — InMemoryArtifactStore
 * - `./event-bus.ts` — 事件订阅 / 发布（含 Redis PubSub）
 * - `./workflow-engine.ts` — 本文件，仅保留 executor 与编排逻辑（startWorkflow /
 *   executeWorkflow / getWorkflowStatus / cancelWorkflow）
 *
 * 后续再拆：文件涨到 ~1700 行后按管线步骤下沉到 `./workflow/`（纯结构拆分，零行为变更）：
 * - `./workflow/context.ts` — logger / executeAgentStep / setReviewArtifact
 * - `./workflow/credits.ts` — 幂等逐项扣费
 * - `./workflow/progress.ts` — 进度百分比（纯函数）
 * - `./workflow/scene-persistence.ts` — Scene 表读写辅助
 * - `./workflow/project-characters.ts` — 视频/配音阶段共用角色查表
 * - `./workflow/steps/*.ts` — script / characters / storyboard / images / videos / audio / review
 *
 * 本文件退回纯编排：按原顺序调用各 step，错误处理 / fire-and-forget 语义 / DB 写序均不变。
 * 对外 API 保持不变；`subscribeWorkflowEvents` 以 re-export 形式暴露。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { InMemoryArtifactStore } from "./artifact-store";
import {
  subscribeWorkflowEvents as _subscribeWorkflowEvents,
  emitEvent,
} from "./event-bus";
import { log } from "./workflow/context";
import { computeWorkflowProgress } from "./workflow/progress";
import { runScriptStep } from "./workflow/steps/script";
import { runCharacterBibleStep } from "./workflow/steps/characters";
import { runStoryboardStep } from "./workflow/steps/storyboard";
import { executeImageGeneration } from "./workflow/steps/images";
import { executeMediaGeneration } from "./workflow/steps/videos";
import { reviewVideoCoherence } from "./workflow/steps/review";
import type {
  WorkflowConfig,
  WorkflowContext,
  WorkflowStep,
  WorkflowStatus,
  WorkflowRunStatus,
  WorkflowStepInfo,
} from "./types";

// Re-export 保持兼容
export { subscribeWorkflowEvents } from "./event-bus";
// 消除"未使用"告警
void _subscribeWorkflowEvents;

// ============ Workflow Engine ============

/** 启动新 workflow */
export async function startWorkflow(
  projectId: string,
  userId: string,
  inputText: string,
  config: WorkflowConfig
): Promise<string> {
  const workflowRun = await prisma.workflowRun.create({
    data: {
      projectId,
      userId,
      status: "PENDING",
      config: JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue,
      artifacts: {} as Prisma.InputJsonValue,
    },
  });

  // 异步执行（不阻塞请求）
  executeWorkflow(workflowRun.id, inputText, config).catch((err) => {
    log.error(`Workflow ${workflowRun.id} failed:`, err);
  });

  return workflowRun.id;
}

/** 获取 workflow 状态 */
export async function getWorkflowStatus(
  workflowRunId: string
): Promise<WorkflowStatus | null> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: { steps: { orderBy: { createdAt: "asc" } } },
  });

  if (!run) return null;

  const steps: WorkflowStepInfo[] = run.steps.map((s) => ({
    step: s.step as WorkflowStep,
    status: s.status as WorkflowStepInfo["status"],
    agentName: s.agentName,
    attempts: s.attempts,
    tokensUsed: s.tokensUsed,
    reasoning: s.reasoning ?? undefined,
    error: s.error ?? undefined,
    startedAt: s.startedAt ?? undefined,
    completedAt: s.completedAt ?? undefined,
  }));

  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status as WorkflowRunStatus,
    currentStep: (run.currentStep as WorkflowStep) ?? null,
    steps,
    progress: computeWorkflowProgress(steps),
    error: run.error ?? undefined,
    startedAt: run.startedAt ?? undefined,
    completedAt: run.completedAt ?? undefined,
  };
}

/** 取消 workflow */
export async function cancelWorkflow(workflowRunId: string): Promise<void> {
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: { status: "FAILED", error: "用户取消" },
  });
}

// ============ 内部执行逻辑 ============

async function executeWorkflow(
  workflowRunId: string,
  inputText: string,
  config: WorkflowConfig
): Promise<void> {
  const artifacts = new InMemoryArtifactStore();

  const ctx: WorkflowContext = {
    workflowRunId,
    projectId: "",
    userId: "",
    config,
    artifacts,
    emit: emitEvent,
  };

  // try 上移：把「获取 run + 标记 RUNNING」也包进来。否则前置 throw 会被
  // startWorkflow 的 .catch 只打日志吞掉，status 永久卡 PENDING（reliability P0-3）。
  try {
    // 获取 run 信息
    const run = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
    });
    if (!run) throw new Error(`WorkflowRun ${workflowRunId} not found`);
    ctx.projectId = run.projectId;
    ctx.userId = run.userId;

    // 标记开始
    await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    emitEvent({
      type: "workflow:started",
      workflowRunId,
      data: { projectId: ctx.projectId },
      timestamp: new Date(),
    });

    // ===== Step 1: 剧本解析 =====
    const script = await runScriptStep(inputText, ctx);

    // ===== Step 2: 角色圣经（含闭环2 评审 + 角色回写 + 锚点回填） =====
    const characterBible = await runCharacterBibleStep(script, ctx);

    // ===== Step 3: 分镜补全（含闭环3 叙事连贯评审） =====
    const storyboard = await runStoryboardStep(script, characterBible, ctx);

    // ===== Step 4: 图像生成（Fan-out per scene） =====
    if (config.image) {
      await executeImageGeneration(storyboard.scenes, characterBible, ctx);
    }

    // ===== Step 5: 视频 + 音频（并行 Fan-out） =====
    if (config.video || config.tts) {
      // v2：把 characterBible 传给视频阶段，激活身份前缀 + 多参考图
      await executeMediaGeneration(storyboard.scenes, ctx, characterBible);

      // ===== 闭环4：视频连贯评审（P3.5，默认关闭，开启后评分并记录） =====
      if (config.video) {
        await reviewVideoCoherence(storyboard, ctx);
      }
    }

    // 标记完成
    await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        artifacts: JSON.parse(
          JSON.stringify(artifacts.toJSON())
        ) as Prisma.InputJsonValue,
      },
    });

    emitEvent({
      type: "workflow:completed",
      workflowRunId,
      data: { progress: 100 },
      timestamp: new Date(),
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    log.error(`Workflow ${workflowRunId} failed: ${errorMsg}`);

    await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: "FAILED",
        error: errorMsg,
        artifacts: JSON.parse(
          JSON.stringify(artifacts.toJSON())
        ) as Prisma.InputJsonValue,
      },
    });

    emitEvent({
      type: "workflow:failed",
      workflowRunId,
      data: { error: errorMsg },
      timestamp: new Date(),
    });
  }
}
