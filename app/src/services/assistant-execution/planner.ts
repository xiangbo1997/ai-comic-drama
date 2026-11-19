import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AssistantExecutionError,
  type AssistantExecutionOptions,
  type AssistantExecutionPlan,
} from "@/lib/assistant-execution";
import { describeAssistantCapabilities } from "./tools";
import { legacyTitleLocationIds } from "@/lib/drama-locations";

// JSONB重排对象键；确认从持久状态重读options时仍必须产生相同快照指纹。
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}

async function loadProject(
  userId: string,
  projectId: string,
  db: Pick<Prisma.TransactionClient, "project" | "series"> = prisma
) {
  const project = await db.project.findFirst({
    where: { id: projectId, userId },
    include: {
      scenes: {
        orderBy: [{ order: "asc" }, { id: "asc" }],
        include: { sceneCharacters: { orderBy: { characterId: "asc" } } },
      },
      locations: { orderBy: { locationKey: "asc" } },
      shortDramaScripts: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { scriptDoc: true },
      },
      characters: {
        orderBy: { characterId: "asc" },
        include: { character: true },
      },
    },
  });
  if (!project) throw new AssistantExecutionError("当前集不存在", 404);
  if (
    project.seriesId &&
    !(await db.series.findFirst({
      where: { id: project.seriesId, userId },
      select: { id: true },
    }))
  )
    throw new AssistantExecutionError("系列不存在", 404);
  return project;
}
function assetHash(project: unknown, options: AssistantExecutionOptions) {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ project, options })))
    .digest("hex");
}
export async function readAssistantAssetFingerprint(
  userId: string,
  projectId: string,
  options: AssistantExecutionOptions,
  db: Pick<Prisma.TransactionClient, "project" | "series"> = prisma
) {
  return assetHash(await loadProject(userId, projectId, db), options);
}
export async function hasLegacyAssistantLocations(
  userId: string,
  projectId: string
) {
  const project = await loadProject(userId, projectId);
  return (
    legacyTitleLocationIds(
      project.scenes,
      project.shortDramaScripts?.[0]?.scriptDoc
    ).size > 0
  );
}
export async function buildAssistantExecutionPlan(
  userId: string,
  projectId: string,
  options: AssistantExecutionOptions
): Promise<AssistantExecutionPlan> {
  const project = await loadProject(userId, projectId);
  const caps = await describeAssistantCapabilities({
    userId,
    projectId,
    options,
  });
  const blockers: string[] = [];
  const referenceWarnings: string[] = [];
  const needsImages = project.scenes.filter((scene) => !scene.imageUrl);
  if (needsImages.length && caps.supportsCharacterReferences === false) {
    referenceWarnings.push(
      "所选图像模型不支持参考图，现有角色/地点参考无法直接约束出图；建议选择支持参考图的模型，不会自动换模型或增加补图费用"
    );
  }
  const checked = new Set<string>();
  for (const scene of needsImages) {
    const ids = new Set([
      ...(scene.selectedCharacterIds ?? []),
      ...(scene.selectedCharacterId ? [scene.selectedCharacterId] : []),
      ...(scene.sceneCharacters ?? []).map((item) => item.characterId),
    ]);
    for (const id of ids) {
      if (checked.has(id)) continue;
      checked.add(id);
      const character = project.characters.find(
        (item) => item.characterId === id || item.character.id === id
      )?.character;
      if (!character)
        referenceWarnings.push(
          `第${scene.order + 1}镜的角色关联已失效，请重新选择角色后制作`
        );
      else if (
        !character.canonicalImageUrl?.trim() &&
        !character.referenceImages.some((url) => url.trim())
      )
        referenceWarnings.push(
          `角色「${character.name}」缺少定妆/参考图，跨镜形象可能漂移；请先在角色页准备参考图，本计划不会额外自动生成角色图`
        );
    }
  }
  if (!project.scenes.length)
    blockers.push("当前集尚无分镜，请先完成分镜再制作");
  if (project.scenes.length > 100)
    blockers.push("单次自主制作最多支持100个分镜，请拆分当前集");
  if (!caps.canInspect)
    blockers.push("所选文本模型不支持视觉检查，请选择支持视觉的模型");
  if (options.maxRepairRounds > 0 && !caps.canRepair)
    blockers.push("所选图像模型不支持参考图修复，请更换模型或关闭自动修复");
  if (
    project.scenes.some(
      (scene) =>
        scene.imageStatus === "PROCESSING" || scene.videoStatus === "PROCESSING"
    )
  )
    blockers.push("当前集有素材正在生成，请等待结束后重新生成计划");
  const steps: AssistantExecutionPlan["steps"] = [
    {
      id: "prepare",
      kind: "prepare",
      label: "整理当前集场景参考资料",
      maxCredits: 0,
    },
  ];
  const legacyIds = legacyTitleLocationIds(
    project.scenes,
    project.shortDramaScripts?.[0]?.scriptDoc
  );
  const keys = [
    ...new Set(
      project.scenes
        .filter((scene) => !legacyIds.has(scene.id))
        .map((scene) => scene.locationKey?.trim())
        .filter((key): key is string => !!key)
    ),
  ];
  const unlabeledLocationSlots = project.scenes.filter(
    (scene) => !scene.locationKey?.trim() || legacyIds.has(scene.id)
  ).length;
  if (
    !caps.imageReady &&
    (project.scenes.some((scene) => !scene.imageUrl) ||
      options.maxRepairRounds > 0 ||
      unlabeledLocationSlots > 0 ||
      keys.some(
        (key) =>
          !project.locations.find((item) => item.locationKey === key)?.imageUrl
      ))
  )
    blockers.push("请先选择可用的图像模型，以补齐参考板、缺失图片或修复画面");
  if (
    options.generateVideos &&
    project.scenes.some((scene) => !scene.videoUrl) &&
    !caps.videoReady
  )
    blockers.push("请先选择可用的视频模型");
  for (const key of keys) {
    const location = project.locations.find((item) => item.locationKey === key);
    if (!location?.imageUrl)
      steps.push({
        id: `location:${key}`,
        kind: "location",
        label: `补齐场景参考：${key}`,
        targetId: key,
        maxCredits: caps.locationCost,
      });
  }
  for (const scene of project.scenes)
    if (!scene.imageUrl)
      steps.push({
        id: `image:${scene.id}`,
        kind: "image",
        label: `补齐第${scene.order + 1}镜图片`,
        targetId: scene.id,
        maxCredits: caps.imageMaxCost,
      });
  steps.push({
    id: "inspect:0",
    kind: "inspect",
    label: "检查画面与连续性",
    maxCredits: 0,
  });
  if (caps.canLink)
    steps.push({
      id: "links",
      kind: "links",
      label: "设置适合的镜头衔接",
      maxCredits: 0,
    });
  for (const scene of project.scenes)
    if (options.generateVideos && !scene.videoUrl) {
      const cost = caps.videoCosts[scene.id];
      if (!Number.isSafeInteger(cost) || cost < 0)
        blockers.push(`第${scene.order + 1}镜缺少可用的视频模型报价`);
      else
        steps.push({
          id: `video:${scene.id}`,
          kind: "video",
          label: `生成第${scene.order + 1}镜视频`,
          targetId: scene.id,
          maxCredits: cost,
        });
    }
  const baseCredits =
    steps.reduce((sum, step) => sum + step.maxCredits, 0) +
    unlabeledLocationSlots * caps.locationCost;
  const estimatedCredits =
    baseCredits +
    project.scenes.length * options.maxRepairRounds * caps.imageMaxCost;
  if (estimatedCredits > options.maxCredits)
    blockers.push(
      `含最多${options.maxRepairRounds}轮修复的费用上限为${estimatedCredits}积分，超过设置的${options.maxCredits}积分，请调整上限或执行选项`
    );
  // 仅散列数据快照，不把角色隐私、配置密钥或完整项目资料放进计划响应。
  const assetFingerprint = assetHash(project, options);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        assetFingerprint,
        configFingerprint: caps.configFingerprint,
      })
    )
    .digest("hex");
  return {
    fingerprint,
    assetFingerprint,
    configFingerprint: caps.configFingerprint,
    steps,
    blockers,
    estimatedCredits,
    models: caps.models,
    warnings: [
      ...caps.warnings,
      ...referenceWarnings,
      ...(legacyIds.size
        ? [
            `${legacyIds.size}个分镜的地点来自旧版剧情标题，将先校准物理地点，再按实际地点生成参考图；已有素材保留`,
          ]
        : []),
    ],
    sceneIds: project.scenes.map((scene) => scene.id),
    imageMaxCost: caps.imageMaxCost,
    baseCredits,
    locationCost: caps.locationCost,
    unlabeledLocationSlots,
    locationKeys: keys,
    locationLabelsVersion: 2,
  };
}
