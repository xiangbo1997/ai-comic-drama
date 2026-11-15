import { prisma } from "@/lib/prisma";
import { getUserImageConfig, getUserLLMConfig } from "@/lib/ai-config";
import { getSystemConfig } from "@/lib/system-config";
import { chargeCredits } from "@/lib/credits";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { chatCompletion, generateImage } from "@/services/ai";
import { isStorageConfigured, uploadFileFromUrl } from "@/services/storage";
import {
  LABEL_SYSTEM,
  DESCRIBE_SYSTEM,
  buildLabelPrompt,
  parseLabelOutput,
  buildDescribePrompt,
  parseDescribeOutput,
  buildPlatePrompt,
  buildPlateNegative,
} from "@/services/generation/location-plate";
import type { AssistantActionInput, AssistantActionResult } from "./tool-types";

export async function quoteLocationTool(
  input: AssistantActionInput
): Promise<number> {
  return input.kind === "location" ? getSystemConfig("COST_LOCATION_PLATE") : 0;
}

async function isStopped(input: AssistantActionInput): Promise<boolean> {
  const run = await prisma.generationTask.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      AND: [
        { input: { path: ["userId"], equals: input.userId } },
        { input: { path: ["kind"], equals: "assistant_execution_run" } },
      ],
    },
    select: { output: true },
  });
  const state = run?.output as { status?: string } | null;
  return !state || state.status !== "running";
}
const stoppedResult = (taskId: string): AssistantActionResult => ({
  taskId,
  actualCost: 0,
  requiresReview: true,
  artifact: { title: "已停止后续地点准备与生成", stopped: true },
});

export async function executeLocationTool(
  input: AssistantActionInput,
  taskId: string
): Promise<AssistantActionResult> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true, style: true, aspectRatio: true },
  });
  if (!project) throw new Error("项目不存在或无权访问");
  if (input.kind === "prepare") return prepareLocations(input, taskId);
  if (input.kind !== "location" || !input.targetId)
    throw new Error("场景工具参数无效");
  let location = await prisma.projectLocation.findFirst({
    where: {
      projectId: input.projectId,
      OR: [{ id: input.targetId }, { locationKey: input.targetId }],
    },
    select: { id: true, locationKey: true, description: true, imageUrl: true },
  });
  if (!location) {
    // 计划中的地点可能尚未建行，但必须实际存在于当前项目分镜里。
    const scenes = await prisma.scene.findMany({
      where: { projectId: input.projectId, locationKey: input.targetId },
      select: { description: true },
      take: 1,
    });
    if (!scenes.length) throw new Error("场景地点已变化，请重新生成计划");
    location = await prisma.projectLocation.upsert({
      where: {
        projectId_locationKey: {
          projectId: input.projectId,
          locationKey: input.targetId,
        },
      },
      create: { projectId: input.projectId, locationKey: input.targetId },
      update: {},
      select: {
        id: true,
        locationKey: true,
        description: true,
        imageUrl: true,
      },
    });
  }
  if (location.imageUrl)
    return {
      taskId,
      actualCost: 0,
      artifact: {
        title: "背景参考已存在，已保留",
        imageUrl: location.imageUrl,
        locationId: location.id,
        skipped: true,
      },
    };
  const cost = await quoteLocationTool(input);
  if (!Number.isInteger(cost) || cost < 0 || cost > input.maxCost)
    throw new Error("背景生成费用超过本步骤预算，请重新确认计划");
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { credits: true },
  });
  if (!user || user.credits < cost) throw new Error("积分不足，已暂停生成");
  if (input.options.imageConfigId) {
    const owned = await prisma.userAIConfig.findFirst({
      where: {
        id: input.options.imageConfigId,
        userId: input.userId,
        isEnabled: true,
        provider: { category: "IMAGE", isActive: true },
      },
      select: { id: true },
    });
    if (!owned) throw new Error("所选图像模型不可用");
  }
  const config = await getUserImageConfig(
    input.userId,
    input.options.imageConfigId
  );
  if (!config) throw new Error("请先配置图像模型");
  const samples = await prisma.scene.findMany({
    where: { projectId: input.projectId, locationKey: location.locationKey },
    select: { description: true },
    take: 20,
  });
  const prompt = buildPlatePrompt({
    locationKey: location.locationKey,
    description: location.description,
    sceneHints: samples.map((s) => s.description ?? "").filter(Boolean),
    style: project.style,
  });
  const safety = await contentSafetyMiddleware(prompt, "image");
  if (!safety.safe) throw new Error(safety.reason || "场景内容未通过生成检查");
  if (await isStopped(input)) return stoppedResult(taskId);
  let imageUrl = await generateImage({
    prompt,
    negativePrompt: buildPlateNegative(project.style),
    aspectRatio:
      project.aspectRatio === "16:9" || project.aspectRatio === "1:1"
        ? project.aspectRatio
        : "9:16",
    style: project.style,
    config,
    disableRetries: true,
  });
  if (isStorageConfigured())
    imageUrl = await uploadFileFromUrl(imageUrl, {
      fileName: `location_${location.id}_${Date.now()}.webp`,
      contentType: "image/webp",
      fileType: "image",
      userId: input.userId,
    });
  const locationId = location.id;
  const previousUrl = location.imageUrl;
  const selected = await prisma.$transaction(async (tx) => {
    // 已提交的唯一任务允许收尾，但不能盖过用户运行中选的新背景。
    const updated = await tx.projectLocation.updateMany({
      where: {
        id: locationId,
        projectId: input.projectId,
        imageUrl: previousUrl,
      },
      data: { imageUrl },
    });
    if (cost > 0)
      await chargeCredits(tx, {
        userId: input.userId,
        amount: cost,
        type: "GENERATE_IMAGE",
        source: "assistant:location",
        sourceId: taskId,
        note: `背景参考（${location.locationKey}）`,
      });
    return updated.count > 0;
  });
  return {
    taskId,
    actualCost: cost,
    ...(selected ? {} : { requiresReview: true }),
    artifact: {
      title: selected
        ? "背景参考已生成"
        : "背景已被手动修改，新图保存在任务结果中",
      imageUrl,
      locationId,
      selected,
    },
  };
}

async function prepareLocations(
  input: AssistantActionInput,
  taskId: string
): Promise<AssistantActionResult> {
  if (await isStopped(input)) return stoppedResult(taskId);
  const scenes = await prisma.scene.findMany({
    where: { projectId: input.projectId },
    orderBy: { order: "asc" },
    select: { id: true, order: true, description: true, locationKey: true },
    take: 101,
  });
  if (scenes.length > 100)
    throw new Error("当前集超过100个分镜，请拆分后再自动制作");
  const unlabeled = scenes.filter((scene) => !scene.locationKey?.trim());
  const rows = await prisma.projectLocation.findMany({
    where: { projectId: input.projectId },
    select: { locationKey: true, description: true },
  });
  const known = new Map(rows.map((row) => [row.locationKey, row.description]));
  let labeled = 0;
  let described = 0;
  let needsReview = false;
  let config: Awaited<ReturnType<typeof getUserLLMConfig>>;
  const loadConfig = async () => {
    config ??= await getUserLLMConfig(input.userId, input.options.llmConfigId);
    if (!config) throw new Error("请先配置文字模型");
    return config;
  };
  if (unlabeled.length) {
    const raw = await chatCompletion(
      [
        { role: "system", content: LABEL_SYSTEM },
        { role: "user", content: buildLabelPrompt(unlabeled) },
      ],
      {
        config: await loadConfig(),
        temperature: 0.3,
        maxTokens: 2048,
        timeoutMs: 75_000,
      }
    );
    if (await isStopped(input)) return stoppedResult(taskId);
    const labels = parseLabelOutput(raw, unlabeled);
    const initial = new Map(unlabeled.map((scene) => [scene.id, scene]));
    await prisma.$transaction(async (tx) => {
      for (const label of labels) {
        const source = initial.get(label.sceneId);
        if (!source) continue;
        const updated = await tx.scene.updateMany({
          where: {
            id: source.id,
            projectId: input.projectId,
            description: source.description,
            locationKey: source.locationKey,
          },
          data: { locationKey: label.locationKey },
        });
        if (updated.count) {
          labeled++;
          source.locationKey = label.locationKey;
        } else needsReview = true;
      }
    });
    if (labels.length !== unlabeled.length) needsReview = true;
  }
  const samples = new Map<string, string[]>();
  for (const scene of scenes) {
    const key = scene.locationKey?.trim();
    if (!key) continue;
    const values = samples.get(key) ?? [];
    if (scene.description && values.length < 20)
      values.push(scene.description.slice(0, 1000));
    samples.set(key, values);
  }
  const targets = [...samples]
    .filter(([key]) => !known.get(key)?.trim())
    .map(([locationKey, sceneDescriptions]) => ({
      locationKey,
      sceneDescriptions,
    }));
  if (targets.length) {
    if (await isStopped(input)) return stoppedResult(taskId);
    const raw = await chatCompletion(
      [
        { role: "system", content: DESCRIBE_SYSTEM },
        { role: "user", content: buildDescribePrompt(targets) },
      ],
      {
        config: await loadConfig(),
        temperature: 0.3,
        maxTokens: 2048,
        timeoutMs: 75_000,
      }
    );
    if (await isStopped(input)) return stoppedResult(taskId);
    const descriptions = parseDescribeOutput(raw, targets);
    for (const description of descriptions) {
      const row = await prisma.projectLocation.upsert({
        where: {
          projectId_locationKey: {
            projectId: input.projectId,
            locationKey: description.locationKey,
          },
        },
        create: {
          projectId: input.projectId,
          locationKey: description.locationKey,
          description: description.description,
        },
        update: {},
        select: { id: true },
      });
      // 生成期间手动补好的描述优先，不能用模型晚回包覆盖。
      await prisma.projectLocation.updateMany({
        where: { id: row.id, OR: [{ description: null }, { description: "" }] },
        data: { description: description.description },
      });
      described++;
    }
    if (descriptions.length !== targets.length) needsReview = true;
  }
  return {
    taskId,
    actualCost: 0,
    ...(needsReview ? { requiresReview: true } : {}),
    artifact: {
      title: "场景地点准备完成",
      labeled,
      described,
      locations: [...samples.keys()],
    },
  };
}
