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
 * 对外 API 保持不变；`subscribeWorkflowEvents` 以 re-export 形式暴露。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { ScriptParserAgent } from "./script-parser-agent";
import { CharacterBibleAgent } from "./character-bible-agent";
import { StoryboardAgent } from "./storyboard-agent";
import { ImageConsistencyAgent } from "./image-consistency-agent";
import { generateVideo, synthesizeSpeech } from "@/services/ai";
import { InMemoryArtifactStore } from "./artifact-store";
import {
  subscribeWorkflowEvents as _subscribeWorkflowEvents,
  emitEvent,
} from "./event-bus";
import type {
  WorkflowConfig,
  WorkflowContext,
  WorkflowEvent,
  WorkflowStep,
  WorkflowStatus,
  WorkflowRunStatus,
  WorkflowStepInfo,
  ScriptArtifact,
  CharacterBible,
  StoryboardArtifact,
  SceneArtifact,
  ImageArtifact,
} from "./types";

// Re-export 保持兼容
export { subscribeWorkflowEvents } from "./event-bus";
// 保留占位，让 executor 代码不变
const log = createLogger("workflow-engine");
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

  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const totalSteps = 7; // 固定步骤数

  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status as WorkflowRunStatus,
    currentStep: (run.currentStep as WorkflowStep) ?? null,
    steps,
    progress: Math.round((completedSteps / totalSteps) * 100),
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

  try {
    // ===== Step 1: 剧本解析 =====
    const scriptResult = await executeAgentStep(
      "parse_script",
      "script_parser",
      new ScriptParserAgent(),
      { text: inputText },
      ctx
    );

    if (!scriptResult.success || !scriptResult.data) {
      throw new Error(scriptResult.error ?? "剧本解析失败");
    }

    const script = scriptResult.data as ScriptArtifact;
    artifacts.set({
      id: "script",
      type: "script",
      version: 1,
      data: script,
      createdBy: "script_parser",
      createdAt: new Date(),
    });

    // 保存场景到项目数据库
    await saveScenesToProject(ctx.projectId, script);

    // ===== Step 2: 角色圣经 =====
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

    const characterBible = bibleResult.data as CharacterBible;
    artifacts.set({
      id: "character_bible",
      type: "character_bible",
      version: 1,
      data: characterBible,
      createdBy: "character_bible",
      createdAt: new Date(),
    });

    // ===== Step 3: 分镜补全 =====
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
    artifacts.set({
      id: "storyboard",
      type: "storyboard",
      version: 1,
      data: storyboard,
      createdBy: "storyboard",
      createdAt: new Date(),
    });

    // ===== Step 4: 图像生成（Fan-out per scene） =====
    if (config.image) {
      await executeImageGeneration(storyboard.scenes, characterBible, ctx);
    }

    // ===== Step 5: 视频 + 音频（并行 Fan-out） =====
    if (config.video || config.tts) {
      await executeMediaGeneration(storyboard.scenes, ctx);
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

/** 执行单个 Agent 步骤，持久化状态 */
async function executeAgentStep<TInput, TOutput>(
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

/** 场景级并行图像生成 */
async function executeImageGeneration(
  scenes: SceneArtifact[],
  characterBible: CharacterBible,
  ctx: WorkflowContext
): Promise<void> {
  const imageAgent = new ImageConsistencyAgent();

  emitEvent({
    type: "step:started",
    workflowRunId: ctx.workflowRunId,
    step: "generate_images",
    data: {
      totalScenes: scenes.length,
      message: `开始生成 ${scenes.length} 个场景的图像...`,
    },
    timestamp: new Date(),
  });

  // 并发控制：最多 3 个场景同时生成
  const concurrency = 3;
  const results: ImageArtifact[] = [];

  for (let i = 0; i < scenes.length; i += concurrency) {
    const batch = scenes.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((scene) => imageAgent.run({ scene, characterBible }, ctx))
    );

    for (const result of batchResults) {
      if (
        result.status === "fulfilled" &&
        result.value.success &&
        result.value.data
      ) {
        results.push(result.value.data);
        // 更新场景图像到数据库
        await updateSceneImage(ctx.projectId, result.value.data);
      }
    }

    emitEvent({
      type: "progress:update",
      workflowRunId: ctx.workflowRunId,
      step: "generate_images",
      data: {
        completed: Math.min(i + concurrency, scenes.length),
        total: scenes.length,
      },
      timestamp: new Date(),
    });
  }
}

/** 视频 + 音频并行生成 */
async function executeMediaGeneration(
  scenes: SceneArtifact[],
  ctx: WorkflowContext
): Promise<void> {
  emitEvent({
    type: "step:started",
    workflowRunId: ctx.workflowRunId,
    step: "generate_videos",
    data: { message: "开始生成视频和配音..." },
    timestamp: new Date(),
  });

  // 获取已生成图片的场景
  const dbScenes = await prisma.scene.findMany({
    where: {
      project: { id: ctx.projectId },
      imageUrl: { not: null },
    },
    orderBy: { order: "asc" },
  });

  for (const dbScene of dbScenes) {
    const sceneArtifact = scenes.find((s) => s.order === dbScene.order);
    if (!sceneArtifact || !dbScene.imageUrl) continue;

    const tasks: Promise<void>[] = [];

    // 视频生成
    if (ctx.config.video) {
      tasks.push(
        generateVideo({
          imageUrl: dbScene.imageUrl,
          prompt: sceneArtifact.description,
          duration: sceneArtifact.duration > 5 ? 10 : 5,
          config: ctx.config.video,
        })
          .then(async (videoUrl) => {
            await prisma.scene.update({
              where: { id: dbScene.id },
              data: { videoUrl, videoStatus: "COMPLETED" },
            });
          })
          .catch(async () => {
            await prisma.scene.update({
              where: { id: dbScene.id },
              data: { videoStatus: "FAILED" },
            });
          })
      );
    }

    // TTS 生成
    if (ctx.config.tts) {
      const text = sceneArtifact.dialogue ?? sceneArtifact.narration;
      if (text) {
        tasks.push(
          synthesizeSpeech({
            text,
            config: ctx.config.tts,
          })
            .then(async () => {
              await prisma.scene.update({
                where: { id: dbScene.id },
                data: { audioStatus: "COMPLETED" },
              });
            })
            .catch(async () => {
              await prisma.scene.update({
                where: { id: dbScene.id },
                data: { audioStatus: "FAILED" },
              });
            })
        );
      }
    }

    await Promise.allSettled(tasks);
  }

  emitEvent({
    type: "step:completed",
    workflowRunId: ctx.workflowRunId,
    step: "generate_videos",
    data: { message: "视频和配音生成完成" },
    timestamp: new Date(),
  });
}

// ============ 数据库辅助 ============

/**
 * 保存分镜到项目（Stage 2.6：幂等 diff-upsert）
 *
 * 原先是 deleteMany + createMany —— 每次 workflow 重跑都会丢失已生成的 imageUrl/videoUrl/audioUrl。
 * 现在按 order 匹配：
 * - 同一 order：update 文本字段（shotType/description/...）但**保留**已生成的 URL 与状态
 * - 新增 order：create（默认 PENDING）
 * - 被删除的 order（新 script 比老 script 少）：删除多余
 *
 * 这样重跑 workflow 时，已完成图像/视频的分镜不需要重新生成。
 */
async function saveScenesToProject(
  projectId: string,
  script: ScriptArtifact
): Promise<void> {
  const existing = await prisma.scene.findMany({
    where: { projectId },
    select: { id: true, order: true },
  });
  const existingByOrder = new Map(existing.map((s) => [s.order, s.id]));
  const newOrders = new Set<number>();

  for (let idx = 0; idx < script.scenes.length; idx++) {
    const s = script.scenes[idx];
    const order = idx + 1;
    newOrders.add(order);
    const sceneId = existingByOrder.get(order);

    if (sceneId) {
      // 更新文本字段；不触碰 imageUrl/videoUrl/audioUrl 与三个 status
      await prisma.scene.update({
        where: { id: sceneId },
        data: {
          shotType: s.shotType,
          description: s.description,
          dialogue: s.dialogue,
          narration: s.narration,
          emotion: s.emotion,
          duration: s.duration,
        },
      });
    } else {
      await prisma.scene.create({
        data: {
          projectId,
          order,
          shotType: s.shotType,
          description: s.description,
          dialogue: s.dialogue,
          narration: s.narration,
          emotion: s.emotion,
          duration: s.duration,
          imageStatus: "PENDING",
          videoStatus: "PENDING",
          audioStatus: "PENDING",
        },
      });
    }
  }

  // 删除多余的 order（新 script 长度缩短时）
  const stale = existing
    .filter((s) => !newOrders.has(s.order))
    .map((s) => s.id);
  if (stale.length > 0) {
    await prisma.scene.deleteMany({ where: { id: { in: stale } } });
  }
}

async function updateSceneImage(
  projectId: string,
  image: ImageArtifact
): Promise<void> {
  const scene = await prisma.scene.findFirst({
    where: { projectId, order: image.sceneId },
  });

  if (scene) {
    await prisma.scene.update({
      where: { id: scene.id },
      data: {
        imageUrl: image.imageUrl,
        imageStatus: "COMPLETED",
      },
    });
  }
}
