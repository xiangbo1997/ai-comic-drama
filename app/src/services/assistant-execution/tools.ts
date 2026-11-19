import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  getUserImageConfig,
  getUserVideoConfig,
  getUserLLMConfig,
} from "@/lib/ai-config";
import { getSystemConfigs, getVideoTierCosts } from "@/lib/system-config";
import { getImageProviderCapability } from "@/services/ai/provider-factory";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import { supportsVisionReview } from "@/services/agents/vision-reviewer";
import { estimateVideoCost, clampSceneDuration } from "@/services/generation";
import { buildVideoScenePrompt } from "@/lib/prompts";
import { submitImageJob } from "@/services/generation/jobs/image";
import { submitVideoJob } from "@/services/generation/jobs/video";
import {
  createGenerationJob,
  claimGenerationJob,
} from "@/services/generation/jobs/operation";
import { executeLocationTool } from "./tool-locations";
import { executeReviewTool } from "./tool-review";
import type {
  AssistantActionInput,
  AssistantActionResult,
  AssistantActionReconciliation,
  AssistantToolOptions,
} from "./tool-types";
export type {
  AssistantActionInput,
  AssistantActionResult,
  AssistantActionReconciliation,
} from "./tool-types";

async function assertSelectedConfigs(
  userId: string,
  options: AssistantToolOptions
) {
  for (const [configId, category] of [
    [options.imageConfigId, "IMAGE"],
    [options.videoConfigId, "VIDEO"],
    [options.llmConfigId, "LLM"],
  ] as const) {
    if (
      configId &&
      !(await prisma.userAIConfig.findFirst({
        where: {
          id: configId,
          userId,
          isEnabled: true,
          provider: { category, isActive: true },
        },
        select: { id: true },
      }))
    )
      throw new Error("所选模型配置不可用，请重新确认计划");
  }
}

export async function describeAssistantCapabilities(input: {
  userId: string;
  projectId: string;
  options: AssistantToolOptions;
}) {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { scenes: { select: { id: true, duration: true } } },
  });
  if (!project) throw new Error("当前作品不存在");
  await assertSelectedConfigs(input.userId, input.options);
  const [image, video, llm, prices, tiers] = await Promise.all([
    getUserImageConfig(input.userId, input.options.imageConfigId),
    getUserVideoConfig(input.userId, input.options.videoConfigId),
    getUserLLMConfig(input.userId, input.options.llmConfigId),
    getSystemConfigs(),
    getVideoTierCosts(),
  ]);
  const imageCap = image
    ? getImageProviderCapability(image.protocol, image.model)
    : undefined;
  const videoCap = video
    ? getVideoModelCapability(video.protocol, video.model)
    : undefined;
  const models = {
    image: image?.model ?? "",
    video: video?.model ?? "",
    llm: llm?.model ?? "",
  };
  const warnings: string[] = [];
  if (!image) warnings.push("尚未配置图像模型");
  if (!video) warnings.push("尚未配置视频模型");
  if (!llm || !supportsVisionReview(llm))
    warnings.push("当前文本模型不能执行视觉检查");
  return {
    models,
    warnings,
    imageReady: !!image,
    videoReady: !!video,
    imageMaxCost: Math.max(
      prices.COST_IMAGE_NORMAL,
      prices.COST_IMAGE_WITH_REF
    ),
    locationCost: prices.COST_LOCATION_PLATE,
    videoCosts: Object.fromEntries(
      project.scenes.map((scene) => [
        scene.id,
        videoCap
          ? estimateVideoCost(
              clampSceneDuration(scene.duration),
              videoCap,
              tiers
            )
          : -1,
      ])
    ),
    canRepair: !!imageCap?.supportsReferenceImage,
    supportsCharacterReferences: !!imageCap?.supportsReferenceImage,
    canInspect: !!llm && supportsVisionReview(llm),
    canLink: !!videoCap?.supportsFirstLastFrame && !!llm,
    // 凭据只参与不可逆整体散列，不返回给浏览器或放入任务资料。
    configFingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          image,
          video,
          llm,
          prices: {
            image: prices.COST_IMAGE_NORMAL,
            reference: prices.COST_IMAGE_WITH_REF,
            location: prices.COST_LOCATION_PLATE,
            tiers,
          },
        })
      )
      .digest("hex"),
  };
}

function actionResult(
  taskId: string,
  cost: number,
  raw: unknown
): AssistantActionResult {
  const output =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (typeof output.actualCost === "number")
    return { ...output, taskId } as unknown as AssistantActionResult;
  return {
    taskId,
    actualCost: typeof output.cost === "number" ? output.cost : cost,
    artifact: output,
    ...(output.conflict === true ? { requiresReview: true } : {}),
  };
}

export async function reconcileAssistantAction(
  input: Omit<AssistantActionInput, "onTaskCreated">,
  taskId?: string
): Promise<AssistantActionReconciliation> {
  const task = taskId
    ? await prisma.generationTask.findUnique({ where: { id: taskId } })
    : await prisma.generationTask.findFirst({
        where: {
          input: { path: ["operationKey"], equals: input.operationKey },
        },
      });
  if (!task) return { status: "not_started" };
  const metadata = task.input as Record<string, unknown>;
  if (
    metadata.userId !== input.userId ||
    metadata.executionRunId !== input.runId ||
    metadata.operationKey !== input.operationKey ||
    task.projectId !== input.projectId
  )
    return { status: "unknown", error: "执行任务归属不匹配" };
  const output = task.output as Record<string, unknown> | null;
  if (output?.unknown === true)
    return {
      status: "unknown",
      taskId: task.id,
      error: "上游执行结果尚未确认，请人工检查后重新规划",
    };
  if (task.status === "COMPLETED")
    return {
      status: "completed",
      taskId: task.id,
      result: actionResult(task.id, task.cost, task.output),
    };
  if (task.status === "FAILED")
    return {
      status: "failed",
      taskId: task.id,
      error: "生成未完成，请检查任务后重试",
    };
  if (task.status === "PENDING")
    return { status: "not_started", taskId: task.id };
  return { status: "processing", taskId: task.id };
}

async function awaitOwnTask(
  input: AssistantActionInput,
  taskId: string
): Promise<AssistantActionResult> {
  // 仅等待当前进程刚提交的持久任务；重启恢复交由runner按receipt核对，不再次发单。
  for (let poll = 0; poll < 2400; poll++) {
    const state = await reconcileAssistantAction(input, taskId);
    if (state.status === "completed" && state.result) return state.result;
    if (state.status === "failed" || state.status === "unknown")
      throw new Error(state.error);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("生成任务仍在执行，请稍后核对结果；系统不会自动重复提交");
}

export async function executeAssistantAction(
  input: AssistantActionInput
): Promise<AssistantActionResult> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true, style: true, aspectRatio: true },
  });
  if (!project) throw new Error("当前作品不存在");
  await assertSelectedConfigs(input.userId, input.options);
  const prior = await reconcileAssistantAction(input);
  if (prior.status === "completed" && prior.result) return prior.result;
  if (prior.status !== "not_started")
    throw new Error(prior.error ?? "已有任务正在执行，不能重复提交");
  const internal = {
    operationKey: input.operationKey,
    executionRunId: input.runId,
    maxCost: input.maxCost,
    disableRetries: true,
    llmConfigId: input.options.llmConfigId,
    onTaskCreated: input.onTaskCreated,
  };
  const aspectRatio =
    project.aspectRatio === "1:1" || project.aspectRatio === "16:9"
      ? project.aspectRatio
      : "9:16";
  if (
    input.kind === "image" ||
    input.kind === "repair" ||
    input.kind === "video"
  ) {
    const scene = await prisma.scene.findFirst({
      where: { id: input.targetId, projectId: input.projectId },
      include: {
        sceneCharacters: {
          where: { character: { userId: input.userId } },
          select: {
            character: {
              select: { canonicalImageUrl: true, referenceImages: true },
            },
          },
        },
      },
    });
    if (!scene) throw new Error("当前分镜不存在");
    if (input.kind === "video") {
      if (scene.videoUrl)
        return {
          actualCost: 0,
          artifact: { skipped: true, reason: "已有视频" },
        };
      if (!scene.imageUrl) throw new Error("该分镜尚无图片，无法生成视频");
      const next = scene.videoLinkNext
        ? await prisma.scene.findFirst({
            where: { projectId: input.projectId, order: { gt: scene.order } },
            orderBy: { order: "asc" },
            select: { imageUrl: true },
          })
        : null;
      const submission = await submitVideoJob(
        input.userId,
        {
          projectId: input.projectId,
          sceneId: scene.id,
          imageUrl: scene.imageUrl,
          prompt: buildVideoScenePrompt({
            dialogue: scene.dialogue,
            shotType: scene.shotType,
            cameraAngle: scene.cameraAngle,
            lighting: scene.lighting,
            emotion: scene.emotion,
            beatType: scene.beatType,
            description: scene.description,
            style: project.style,
            duration: scene.duration,
            actionBeat: scene.actionBeat,
            cameraMovement: scene.cameraMovement,
            hasLastFrame: !!next?.imageUrl,
          }),
          duration: scene.duration,
          aspectRatio,
          videoConfigId: input.options.videoConfigId,
          lastFrameImage: next?.imageUrl ?? undefined,
        },
        { ...internal, expectedVideoUrl: null }
      );
      return awaitOwnTask(input, submission.taskId);
    }
    if (input.kind === "image" && scene.imageUrl)
      return { actualCost: 0, artifact: { skipped: true, reason: "已有图片" } };
    if (input.kind === "repair" && !scene.imageUrl)
      throw new Error("待修复分镜尚无图片");
    const imageConfig = await getUserImageConfig(
      input.userId,
      input.options.imageConfigId
    );
    if (!imageConfig) throw new Error("请先配置图像模型");
    if (
      input.kind === "repair" &&
      !getImageProviderCapability(imageConfig.protocol, imageConfig.model)
        .supportsReferenceImage
    )
      throw new Error("当前图像模型不支持参考图修复");
    const anchor = input.anchorSceneId
      ? await prisma.scene.findFirst({
          where: { id: input.anchorSceneId, projectId: input.projectId },
          select: { imageUrl: true },
        })
      : null;
    const refs =
      input.kind === "repair"
        ? [scene.imageUrl!]
        : scene.sceneCharacters.flatMap(({ character }) =>
            character.canonicalImageUrl
              ? [character.canonicalImageUrl]
              : character.referenceImages.slice(0, 1)
          );
    const submission = await submitImageJob(
      input.userId,
      {
        projectId: input.projectId,
        sceneId: scene.id,
        prompt: scene.description,
        style: project.style,
        aspectRatio,
        imageConfigId: input.options.imageConfigId,
        count: 1,
        referenceImages: refs,
        iterate: input.kind === "repair",
        note: input.note,
        iterationAnchorUrl: anchor?.imageUrl ?? undefined,
      },
      {
        ...internal,
        expectedSceneImageUrl: input.kind === "repair" ? scene.imageUrl : null,
      }
    );
    return awaitOwnTask(input, submission.taskId);
  }

  const task = await createGenerationJob(
    {
      data: {
        type: "IMAGE_GENERATE",
        status: "PENDING",
        projectId: input.projectId,
        cost: input.maxCost,
        input: {
          kind: `assistant_${input.kind}`,
          userId: input.userId,
          targetId: input.targetId ?? null,
        },
      },
    },
    input.userId,
    internal
  );
  if (!(await claimGenerationJob(task.id, true, input.runId)))
    throw new Error("已有任务正在执行或计划已停止，不能重复提交");
  try {
    const result =
      input.kind === "prepare" || input.kind === "location"
        ? await executeLocationTool(input, task.id)
        : await executeReviewTool(input, task.id);
    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        status: "COMPLETED",
        cost: result.actualCost,
        output: result as never,
        completedAt: new Date(),
      },
    });
    return { ...result, taskId: task.id };
  } catch (error) {
    // 付费工具开始后无法证明上游未处理的失败，一律保留未知receipt禁止自动重发。
    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        error: "执行工具未完成",
        ...(input.kind === "location" ? { output: { unknown: true } } : {}),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
