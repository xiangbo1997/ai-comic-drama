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
import { reviewStoryboard, reviewVideoSequence } from "./narrative-observer";
import { reviewCharacterBible } from "./character-bible-observer";
import { resolvePolicy, runClosedLoop } from "./closed-loop";
import { synthesizeSpeech } from "@/services/ai";
import { getThreeViewUrls } from "@/lib/three-views";
import { loadSeriesMemoryDigest } from "@/lib/series-memory";
import { parseStoryBible } from "@/types/series-bible";
import { extractSeriesPalette } from "@/lib/series";
import { buildVideoScenePrompt } from "@/lib/prompts";
import {
  directVideoScene,
  generateSceneVideoSegmented,
  estimateVideoCost,
} from "@/services/generation";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import {
  uploadFile,
  uploadFileFromUrl,
  isStorageConfigured,
} from "@/services/storage";
import { probeMediaDurationFromUrl } from "@/services/video-synthesis";
import {
  chargeCredits,
  InsufficientCreditsError,
  type ChargeType,
} from "@/lib/credits";
import { InMemoryArtifactStore } from "./artifact-store";
import {
  subscribeWorkflowEvents as _subscribeWorkflowEvents,
  emitEvent,
} from "./event-bus";
import type {
  WorkflowConfig,
  WorkflowContext,
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
import type {
  SceneCharacterInfo,
  CharacterRole,
} from "@/services/generation/types";

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
    // 系列续集：注入既定设定 digest，解析结果不与前作矛盾（人物/世界观/伏笔）。
    // 非系列项目返回 null，对解析行为无影响。
    const parseSeriesContext =
      (await loadSeriesMemoryDigest(ctx.projectId, "script")) ?? undefined;
    const scriptResult = await executeAgentStep(
      "parse_script",
      "script_parser",
      new ScriptParserAgent(),
      { text: inputText, seriesContext: parseSeriesContext },
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

    let characterBible = bibleResult.data as CharacterBible;

    // ===== 闭环2：角色圣经质量评审（P3.5，纯函数评分，不达标可重生成一次） =====
    characterBible = await reviewAndRefineCharacterBible(
      script,
      characterBible,
      ctx
    );

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

    // ===== 闭环3：叙事连贯评审（P3.5，默认关闭，开启后评分并记录） =====
    await reviewStoryboardCoherence(storyboard, ctx);

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
async function chargeWorkflowItem(
  ctx: WorkflowContext,
  p: {
    sceneId: string;
    kind: "image" | "video" | "tts";
    amount: number;
    note: string;
  }
): Promise<void> {
  if (p.amount <= 0) return;
  const typeMap: Record<typeof p.kind, ChargeType> = {
    image: "GENERATE_IMAGE",
    video: "GENERATE_VIDEO",
    tts: "GENERATE_TTS",
  };
  const sourceId = `wf:${ctx.workflowRunId}:${p.sceneId}:${p.kind}`;
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

/**
 * 一次性把项目内所有角色解析为 name → SceneCharacterInfo 的 Map，避免逐场景查库（N+1）。
 * 查全部 referenceAssets（不再只查 isCanonical），在内存中分别解析：
 *   - canonicalImageUrl：优先 isCanonical 参考资产（经 i2i 定妆，最可靠）→ 回退 canonicalImageUrl
 *     字段 → 回退旧 referenceImages[0]（与手动路径 api/generate/image 的回退链一致）。
 *   - referenceImageUrls：三视图（front/side/back）在前 + 定妆图兜底，去重——
 *     与手动路径客户端 collectCharacterRefs 同规则。此前只给 1 张定妆图，
 *     workflow 自动路径的三视图从未进入出图参考，与手动路径质量不对等。
 * role 留空占位，由 ImageConsistencyAgent 按场景出场顺序重定（第一个 = primary）。
 */
/**
 * 取项目所属系列的统一色板（精简串）。
 *
 * 非系列项目 / 无 colorScript / 查库异常一律返回 undefined —— 色板是出图增强项，
 * 绝不阻断生成。链路：Project.seriesId → Series.storyBible(Json) → parseStoryBible
 * （容错，永不抛错）→ extractSeriesPalette（裸色板事实）。
 */
async function loadSeriesPalette(
  projectId: string
): Promise<string | undefined> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { seriesId: true },
    });
    if (!project?.seriesId) return undefined;
    const series = await prisma.series.findUnique({
      where: { id: project.seriesId },
      select: { storyBible: true },
    });
    if (!series) return undefined;
    return extractSeriesPalette(parseStoryBible(series.storyBible));
  } catch (err) {
    log.warn(
      `[workflow] 加载系列色板失败，按无色板出图`,
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

async function resolveProjectCharacters(
  projectId: string
): Promise<Map<string, SceneCharacterInfo>> {
  const characters = await prisma.character.findMany({
    where: { projects: { some: { projectId } } },
    include: {
      appearance: true,
      referenceAssets: {
        select: {
          url: true,
          pose: true,
          isCanonical: true,
          qualityScore: true,
          createdAt: true,
        },
      },
    },
  });

  const map = new Map<string, SceneCharacterInfo>();
  for (const c of characters) {
    // 定妆图：isCanonical 资产按 qualityScore desc（null 视为最低）、createdAt asc 取最优
    const canonicalFromAsset = c.referenceAssets
      .filter((a) => a.isCanonical)
      .sort(
        (a, b) =>
          (b.qualityScore ?? -1) - (a.qualityScore ?? -1) ||
          a.createdAt.getTime() - b.createdAt.getTime()
      )[0]?.url;
    const canonicalImageUrl =
      canonicalFromAsset ?? c.canonicalImageUrl ?? c.referenceImages[0];

    // 多角度参考：三视图在前、定妆图兜底、去重
    const referenceImageUrls: string[] = [];
    for (const url of getThreeViewUrls(c.referenceAssets)) {
      if (!referenceImageUrls.includes(url)) referenceImageUrls.push(url);
    }
    if (canonicalImageUrl && !referenceImageUrls.includes(canonicalImageUrl)) {
      referenceImageUrls.push(canonicalImageUrl);
    }

    map.set(c.name, {
      id: c.id,
      name: c.name,
      role: "primary" as CharacterRole, // 占位，Agent 按场景顺序重定
      gender: c.gender,
      age: c.age,
      description: c.description,
      referenceImages: c.referenceImages,
      canonicalImageUrl: canonicalImageUrl ?? undefined,
      referenceImageUrls:
        referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
      appearance: c.appearance as SceneCharacterInfo["appearance"],
    });
  }
  return map;
}

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

  // 批次前一次性解析：项目角色（含 canonicalImageUrl）、分镜 order→DB id 映射、项目画幅。
  // 三者都只查一次，杜绝逐场景查库（N+1）。
  const characterMap = await resolveProjectCharacters(ctx.projectId);
  const dbScenes = await prisma.scene.findMany({
    where: { projectId: ctx.projectId },
    select: { id: true, order: true },
  });
  const sceneIdByOrder = new Map(dbScenes.map((s) => [s.order, s.id]));
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { aspectRatio: true },
  });
  const projectAspectRatio = (project?.aspectRatio ?? "9:16") as
    | "1:1"
    | "9:16"
    | "16:9";
  // 负向提示词：服务端只拿得到用户自定义部分（预设逻辑在客户端），
  // 与手动路径「透传客户端 negativePrompt」语义一致。
  const customNegative = ctx.config.generationParams?.customNegative;

  // 色彩设计（color script）：批次前一次性取系列统一色板（非系列 / 无色板为
  // undefined）。透传给出图 Agent，激活「Observer 色调一致性门禁」，让整部剧色调
  // 统一（单镜色彩只在主色板内局部偏移）。查库失败不阻断出图——色板是增强项。
  const seriesPalette = await loadSeriesPalette(ctx.projectId);

  // 为单个场景组装 Agent 输入：注入 DB 解析出的角色 + sceneDbId + 画幅 + 负向词 + 色板
  const buildInput = (scene: SceneArtifact) => {
    const resolvedCharacters = (scene.characters ?? [])
      .map((name) => characterMap.get(name))
      .filter((c): c is SceneCharacterInfo => Boolean(c));
    return {
      scene,
      characterBible,
      resolvedCharacters,
      sceneDbId: sceneIdByOrder.get(scene.order),
      aspectRatio: projectAspectRatio,
      negativePrompt: customNegative,
      seriesPalette,
    };
  };

  // 并发控制：最多 3 个场景同时生成
  const concurrency = 3;
  const results: ImageArtifact[] = [];

  // 累计图像失败数：此前 rejected / success===false 分支完全静默——不 log、
  // 不 emit，用户看到 workflow「完成」但成片缺镜头且日志无痕（a7 P2-10）。
  let imageFailures = 0;

  for (let i = 0; i < scenes.length; i += concurrency) {
    const batch = scenes.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((scene) => imageAgent.run(buildInput(scene), ctx))
    );

    for (const result of batchResults) {
      if (
        result.status === "fulfilled" &&
        result.value.success &&
        result.value.data
      ) {
        results.push(result.value.data);
        // 更新场景图像到数据库
        const sceneId = await updateSceneImage(
          ctx.projectId,
          result.value.data
        );
        // 扣费（与手动路径一致：带参考图 3，否则 1）
        if (sceneId) {
          await chargeWorkflowItem(ctx, {
            sceneId,
            kind: "image",
            amount: result.value.data.strategy === "reference_edit" ? 3 : 1,
            note: `场景 ${result.value.data.sceneId} 图像生成（策略 ${result.value.data.strategy}）`,
          });
        }
      } else {
        // 失败分支不再静默：记日志（含原因），让缺镜头可追溯
        imageFailures++;
        const reason =
          result.status === "rejected"
            ? result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
            : (result.value.error ?? "生成失败");
        log.warn(`Workflow 图像生成失败，该分镜将无图`, { reason });
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

  // 阶段结束：有失败则 emit 一次汇总，让前端能提示「X/Y 成功，Z 张失败」，
  // 不把部分失败伪装成全部完成。
  if (imageFailures > 0) {
    log.warn(
      `Workflow 图像阶段完成：${results.length}/${scenes.length} 成功，${imageFailures} 张失败`
    );
    emitEvent({
      type: "step:completed",
      workflowRunId: ctx.workflowRunId,
      step: "generate_images",
      data: {
        message: `图像生成完成：${results.length} 成功，${imageFailures} 失败（失败分镜将无图，可在编辑器单独重试）`,
        succeeded: results.length,
        failed: imageFailures,
        total: scenes.length,
      },
      timestamp: new Date(),
    });
  }
}

/**
 * v2：把字符串稳定地映射到 [0, 2^31-1) 区间作为 identity seed。
 * 与 image-orchestrator 的 hashStringToSeed 同构（FNV-1a 32 位），保持图像/视频共享同一 seed。
 */
function identitySeedFromCharacterId(characterId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < characterId.length; i += 1) {
    hash ^= characterId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 0x7fffffff;
}

/**
 * v2：构建场景级"角色身份上下文"，用于视频生成时透传：
 *
 *  - referenceImages：取每个角色的 isCanonical 参考图（优先 CharacterReferenceAsset，
 *    退到旧 Character.referenceImages[]），按 role 排序（primary 优先），最多 3 张
 *  - identityPrompt：拼角色 canonicalPrompt 截断（≤200 字符），用于身份维持前缀
 *  - identitySeed：FNV-1a(主角色 id)，与图像端共用
 *
 * 输入：场景 artifact 中的 characters[] (名字数组) + 项目 ID
 * 输出：可直接喂给 generateVideo 的 { referenceImages, identityPrompt, seed }
 */
/** 项目角色（含 canonical 参考资产）查表：name → character，供视频阶段复用 */
type ProjectCharacterMap = Map<
  string,
  Awaited<ReturnType<typeof loadProjectCharacters>>[number]
>;

/**
 * 一次性查询项目全部角色 + canonical 参考资产，建 name→char 查表。
 *
 * 消除 N+1（a3 审计 P0-1）：原 buildSceneCharacterContext 在视频阶段
 * `for (const dbScene of dbScenes)` 循环内每镜发一次 findMany（20 镜=20 次
 * 串行往返，各带 referenceAssets 子查询），叠在本就慢的视频阶段墙钟上。
 * 改为循环前查一次，函数内纯内存查表。
 */
async function loadProjectCharacters(projectId: string) {
  return prisma.character.findMany({
    where: { projects: { some: { projectId } } },
    include: {
      referenceAssets: {
        where: { isCanonical: true },
        orderBy: [{ qualityScore: "desc" }, { createdAt: "asc" }],
      },
    },
  });
}

function buildSceneCharacterContext(
  sceneArtifact: SceneArtifact,
  characterMap: ProjectCharacterMap,
  characterBible: CharacterBible | undefined
): {
  referenceImages: string[];
  identityPrompt?: string;
  seed?: number;
} {
  const characterNames = sceneArtifact.characters ?? [];
  if (characterNames.length === 0) {
    return { referenceImages: [] };
  }

  // 按 sceneArtifact.characters 的顺序排序（第一个角色 = primary），纯内存查表
  const ordered = characterNames
    .map((name) => characterMap.get(name))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  // 收集参考图：优先 referenceAssets.url，回退 Character.referenceImages[0]
  const referenceImages: string[] = [];
  for (const char of ordered) {
    if (char.referenceAssets.length > 0) {
      referenceImages.push(char.referenceAssets[0].url);
    } else if (char.referenceImages.length > 0) {
      referenceImages.push(char.referenceImages[0]);
    }
    if (referenceImages.length >= 3) break;
  }

  // identityPrompt：取主角色的 CharacterBible canonicalPrompt（前 200 字符）
  let identityPrompt: string | undefined;
  if (characterBible && ordered.length > 0) {
    const primaryName = ordered[0].name;
    const bibleEntry = characterBible.characters.find(
      (e) => e.name === primaryName
    );
    if (bibleEntry?.canonicalPrompt) {
      identityPrompt = bibleEntry.canonicalPrompt.slice(0, 200);
    }
  }

  // identitySeed：用主角色 DB id 做 FNV-1a 哈希（与 image-orchestrator 一致）
  const seed =
    ordered.length > 0 ? identitySeedFromCharacterId(ordered[0].id) : undefined;

  return { referenceImages, identityPrompt, seed };
}

/** 视频 + 音频并行生成 */
async function executeMediaGeneration(
  scenes: SceneArtifact[],
  ctx: WorkflowContext,
  characterBible?: CharacterBible
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

  // v2：项目级画幅（与图像端一致，便于 flow2api-video 路由横/竖屏模型）
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { aspectRatio: true },
  });
  const projectAspectRatio = (project?.aspectRatio ?? "9:16") as
    | "1:1"
    | "9:16"
    | "16:9";

  // 循环前一次性查项目全部角色建查表（消除逐镜 N+1）
  const characterList = ctx.config.video
    ? await loadProjectCharacters(ctx.projectId)
    : [];
  const characterMap: ProjectCharacterMap = new Map(
    characterList.map((c) => [c.name, c])
  );

  for (const dbScene of dbScenes) {
    const sceneArtifact = scenes.find((s) => s.order === dbScene.order);
    if (!sceneArtifact || !dbScene.imageUrl) continue;

    const tasks: Promise<void>[] = [];

    // 视频生成
    if (ctx.config.video) {
      // v2：从预查好的角色查表取场景角色上下文（参考图 / identityPrompt / seed），
      // 纯内存查表，无 DB 往返
      const charContext = buildSceneCharacterContext(
        sceneArtifact,
        characterMap,
        characterBible
      );

      // LLM 导演增强（Deliverable 2）：生成前导演一次「运动 + 记忆」。
      // 角色身份锚取 characterBible 的 canonicalPrompt（≤200 字，仅供理解不复述）；
      // 相邻镜取 order±1 的 artifact（承接上、铺垫下）。失败返回 null，回落确定性构建。
      const directorCharacters = (sceneArtifact.characters ?? [])
        .map((name) => {
          const bibleEntry = characterBible?.characters.find(
            (e) => e.name === name
          );
          return {
            name,
            identity: (bibleEntry?.canonicalPrompt ?? "").slice(0, 200),
          };
        })
        .filter((c) => c.name);
      const prevArtifact = scenes.find(
        (s) => s.order === sceneArtifact.order - 1
      );
      const nextArtifact = scenes.find(
        (s) => s.order === sceneArtifact.order + 1
      );
      const direction = await directVideoScene(
        {
          scene: {
            description: sceneArtifact.description,
            actionBeat: sceneArtifact.actionBeat,
            shotType: sceneArtifact.shotType,
            cameraAngle: sceneArtifact.cameraAngle,
            lighting: sceneArtifact.lighting,
            emotion: sceneArtifact.emotion,
            duration: sceneArtifact.duration,
          },
          characters: directorCharacters,
          prevScene: prevArtifact
            ? {
                description: prevArtifact.description,
                actionBeat: prevArtifact.actionBeat,
              }
            : null,
          nextScene: nextArtifact
            ? {
                description: nextArtifact.description,
                actionBeat: nextArtifact.actionBeat,
              }
            : null,
          style: ctx.config.style,
        },
        ctx.config.llm
      );

      // 统一视频 prompt 构建器：镜头语言 + 运镜 + 氛围 + 连续性 + 负面词。
      // 修复：身份前缀此前内联 + provider 双重注入 —— 现在 prompt 不含身份前缀，
      // 仅通过 identityPrompt 选项透传，由 provider 单次 prepend。
      // 导演产出（cameraMovement/actionBeat/atmosphere）优先，缺失回落 artifact 值。
      const videoPrompt = buildVideoScenePrompt({
        description: sceneArtifact.description,
        actionBeat: direction?.actionBeat ?? sceneArtifact.actionBeat,
        style: ctx.config.style,
        shotType: sceneArtifact.shotType,
        cameraAngle: sceneArtifact.cameraAngle,
        cameraMovement:
          direction?.cameraMovement ?? sceneArtifact.cameraMovement,
        lighting: sceneArtifact.lighting,
        emotion: sceneArtifact.emotion,
        atmosphereOverride: direction?.atmosphere,
        duration: sceneArtifact.duration,
        hasLastFrame: false,
      });

      // 分段生成对齐手动路径：按模型能力自动分段（超单段时长拆 N 段无缝拼接），
      // 内部走 storage 门面落自有 URL。计费与手动路径同源（estimateVideoCost）。
      const videoCapability = getVideoModelCapability(
        ctx.config.video?.protocol ?? "",
        ctx.config.video?.model
      );
      const videoCost = estimateVideoCost(
        sceneArtifact.duration,
        videoCapability
      );
      tasks.push(
        generateSceneVideoSegmented({
          imageUrl: dbScene.imageUrl,
          // 用户设定的真实时长（1–60），由分段器按模型能力规划段数
          requestedSeconds: sceneArtifact.duration,
          capability: videoCapability,
          prompts: [videoPrompt],
          aspectRatio: projectAspectRatio,
          // v2：透传角色参考图（激活 flow2api Veo R2V / 后续 Kling Elements / Runway Gen-4 Refs）
          referenceImages:
            charContext.referenceImages.length > 0
              ? charContext.referenceImages
              : undefined,
          // v2：透传 identity seed（与图像端共用 FNV-1a）
          seed: charContext.seed,
          // v2：透传 identityPrompt（provider 可在内部再做一次强化）
          identityPrompt: charContext.identityPrompt,
          config: ctx.config.video,
          userId: ctx.userId,
          projectId: ctx.projectId,
          sceneId: dbScene.id,
        })
          .then(async (segResult) => {
            const isMultiSegment = segResult.segments.length > 1;
            // 单段路径返回 provider 临时 URL，转存自有存储（对齐手动路径，修复
            // flow2api 临时受限域名 URL 浏览器够不到 / 会过期的问题）。多段路径
            // 已是拼接后上传的自有 URL，无需再转存。
            let videoUrl = segResult.videoUrl;
            if (!isMultiSegment && isStorageConfigured()) {
              try {
                videoUrl = await uploadFileFromUrl(segResult.videoUrl, {
                  fileName: `scene_${dbScene.id}_${Date.now()}.mp4`,
                  contentType: "video/mp4",
                  fileType: "video",
                  userId: ctx.userId,
                  projectId: ctx.projectId,
                });
              } catch (uploadErr) {
                log.error(
                  `[workflow] 场景 ${dbScene.id} 视频转存失败，沿用外部 URL`,
                  uploadErr instanceof Error ? uploadErr.message : uploadErr
                );
              }
            }
            // 回写真实时长（对齐手动路径修复的 stale-DB 缺口）：多段路径 orchestrator
            // 已 ffprobe 拼接后总时长；单段路径此处补探一次。真实视频长度即分镜时长。
            let resolvedDuration = sceneArtifact.duration;
            if (
              segResult.measuredDurationSeconds &&
              segResult.measuredDurationSeconds > 0
            ) {
              resolvedDuration = Math.max(
                1,
                Math.round(segResult.measuredDurationSeconds)
              );
            } else {
              try {
                const probed = await probeMediaDurationFromUrl(videoUrl);
                if (probed > 0)
                  resolvedDuration = Math.max(1, Math.round(probed));
              } catch {
                // 探测失败回退声明时长，不阻塞
              }
            }
            await prisma.scene.update({
              where: { id: dbScene.id },
              data: {
                videoUrl,
                videoStatus: "COMPLETED",
                duration: resolvedDuration,
              },
            });
            // 成功后扣费（与手动路径同源估算器，按分段档位求和）
            await chargeWorkflowItem(ctx, {
              sceneId: dbScene.id,
              kind: "video",
              amount: videoCost,
              note: `场景 ${dbScene.id} 视频生成`,
            });
          })
          .catch(async (err) => {
            // 不再静默吞错：记录失败原因，便于 workflow 终态判断与排查
            log.error(
              `[workflow] 场景 ${dbScene.id} 视频生成失败`,
              err instanceof Error ? err.message : err
            );
            await prisma.scene.update({
              where: { id: dbScene.id },
              data: { videoStatus: "FAILED" },
            });
            emitEvent({
              type: "step:failed",
              workflowRunId: ctx.workflowRunId,
              step: "generate_videos",
              data: {
                sceneId: dbScene.id,
                message: `场景 ${dbScene.id} 视频生成失败`,
                error: err instanceof Error ? err.message : String(err),
              },
              timestamp: new Date(),
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
            // 分镜级语速（重跑 workflow 时尊重用户在编辑器调过的值）
            speed: dbScene.ttsSpeed ?? 1.0,
            config: ctx.config.tts,
          })
            .then(async (audioBuffer) => {
              // 修复哑片：synthesizeSpeech 返回音频 Buffer，必须落盘并写回
              // scene.audioUrl，否则导出/预览取不到音轨 → 自动成片无配音。
              // 走 uploadFile 统一门面（R2 已配走云存储 / 未配降级本地盘）。
              const audioUrl = await uploadFile(audioBuffer, {
                fileName: `scene_${dbScene.id}_audio_${Date.now()}.mp3`,
                contentType: "audio/mpeg",
                fileType: "audio",
                userId: ctx.userId,
                projectId: ctx.projectId,
              });
              await prisma.scene.update({
                where: { id: dbScene.id },
                data: { audioUrl, audioStatus: "COMPLETED" },
              });
              // 成功后扣费（2积分/100字，与手动路径一致）
              await chargeWorkflowItem(ctx, {
                sceneId: dbScene.id,
                kind: "tts",
                amount: Math.ceil(text.length / 100) * 2,
                note: `场景 ${dbScene.id} 语音合成（${text.length}字）`,
              });
            })
            .catch(async (err) => {
              // 不再静默吞错
              log.error(
                `[workflow] 场景 ${dbScene.id} 配音生成失败`,
                err instanceof Error ? err.message : err
              );
              await prisma.scene.update({
                where: { id: dbScene.id },
                data: { audioStatus: "FAILED" },
              });
              emitEvent({
                type: "step:failed",
                workflowRunId: ctx.workflowRunId,
                step: "synthesize_voice",
                data: {
                  sceneId: dbScene.id,
                  message: `场景 ${dbScene.id} 配音生成失败`,
                  error: err instanceof Error ? err.message : String(err),
                },
                timestamp: new Date(),
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

/**
 * 闭环3：叙事连贯评审 (P3.5)。
 *
 * 默认关闭（采数据模式）。开启后从导演视角评审整个分镜序列的叙事质量，
 * 把评分通过 SSE 事件记录下来，供后续决定是否触发分镜重生成。
 *
 * 当前版本只评分不重生成（重生成整套分镜成本高，待数据验证后再开启完整闭环）。
 */
/**
 * 闭环2：角色圣经质量评审 + 反思重生成 (P3.5)。
 *
 * 用 runClosedLoop 实现真闭环：CharacterBibleAgent 生成 → reviewCharacterBible
 * 纯函数评分 → 不达标则带 suggestions 重生成。默认关闭时直接返回原圣经。
 * maxRounds 由 policy 控制（默认 2），防止重生成失控。
 *
 * @returns 最优的角色圣经（通过评审的，或历史最高分的；闭环关闭时为原值）
 */
async function reviewAndRefineCharacterBible(
  script: ScriptArtifact,
  bible: CharacterBible,
  ctx: WorkflowContext
): Promise<CharacterBible> {
  const policy = resolvePolicy(ctx, "characterBible");
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

  log.info(
    `Character bible review: score=${result.bestScore}, passed=${result.passed}, rounds=${result.rounds}`
  );

  return result.best ?? bible;
}

async function reviewStoryboardCoherence(
  storyboard: StoryboardArtifact,
  ctx: WorkflowContext
): Promise<void> {
  const policy = resolvePolicy(ctx, "storyboard");
  if (!policy.enabled) return;

  const summaries = storyboard.scenes.map((s) => ({
    id: s.id,
    shotType: s.shotType,
    emotion: s.emotion,
    characters: s.characters,
    description: s.description,
  }));

  const verdict = await reviewStoryboard(summaries, ctx);
  if (!verdict) return;

  emitEvent({
    type: "step:completed",
    workflowRunId: ctx.workflowRunId,
    step: "review_storyboard",
    data: {
      pass: verdict.pass,
      score: verdict.score.overall,
      passThreshold: policy.passThreshold,
      feedback: verdict.score.feedback,
      suggestions: verdict.suggestions,
    },
    timestamp: new Date(),
  });

  log.info(
    `Storyboard narrative review: score=${verdict.score.overall}, pass=${verdict.pass}`
  );
}

/**
 * 闭环4：视频连贯评审 (P3.5)。
 *
 * 默认关闭（采数据模式）。开启后从剪辑师视角评审视频镜头序列的衔接连贯
 * （转场流畅/运动连续/节奏），把评分通过 SSE 记录。
 *
 * 当前只评分不重生成（视频重生成成本最高，待数据验证后再开启完整闭环）。
 */
async function reviewVideoCoherence(
  storyboard: StoryboardArtifact,
  ctx: WorkflowContext
): Promise<void> {
  const policy = resolvePolicy(ctx, "videoCoherence");
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

  log.info(
    `Video coherence review: score=${verdict.score.overall}, pass=${verdict.pass}`
  );
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

    // 镜头语言字段（LLM 解析产出，落库供出图/视频 prompt）
    const cinematics = {
      cameraAngle: s.cameraAngle ?? null,
      lighting: s.lighting ?? null,
      composition: s.composition ?? null,
      colorPalette: s.colorPalette ?? null,
      cameraMovement: s.cameraMovement ?? null,
      // 运动节拍：LLM 导演产出，喂视频 prompt 的 Action 段
      actionBeat: s.actionBeat ?? null,
    };

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
          ...cinematics,
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
          ...cinematics,
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
): Promise<string | null> {
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
    return scene.id;
  }
  return null;
}
