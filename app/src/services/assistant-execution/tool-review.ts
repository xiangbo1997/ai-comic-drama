import { prisma } from "@/lib/prisma";
import { getUserLLMConfig, getUserVideoConfig } from "@/lib/ai-config";
import { resolveContinuityReviewPalette } from "@/lib/review-freshness";
import { chatCompletion } from "@/services/ai";
import {
  compareImagePairWithVision,
  supportsVisionReview,
} from "@/services/agents/vision-reviewer";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import {
  buildPairList,
  assembleContinuityReport,
  type ContinuityPairResult,
} from "@/services/continuity-check";
import { parseOutfitEntries } from "@/services/generation/scene-looks-match";
import {
  prefilterLinkCandidates,
  buildLinkSuggestPrompt,
  parseLinkSuggestOutput,
  LINK_SUGGEST_SYSTEM,
} from "@/services/suggest-links";
import type { AssistantActionInput, AssistantActionResult } from "./tool-types";
import {
  REVIEW_SCENE_SELECT,
  buildAssistantReviewFingerprint,
  readAssistantReviewFingerprint,
} from "./review-fingerprint";

export async function quoteReviewTool(): Promise<number> {
  return 0;
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
  const output = run?.output as { status?: string } | null;
  return !output || output.status === "stopping" || output.status === "stopped";
}

export async function executeReviewTool(
  input: AssistantActionInput,
  taskId: string
): Promise<AssistantActionResult> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true, style: true, seriesId: true },
  });
  if (!project) throw new Error("项目不存在或无权访问");
  const readScenes = () =>
    prisma.scene.findMany({
      where: { projectId: input.projectId },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      take: 101,
      select: REVIEW_SCENE_SELECT,
    });
  const scenes = await readScenes();
  if (scenes.length > 100)
    throw new Error("当前集超过100个分镜，请拆分后自动制作");
  if (await isStopped(input))
    return {
      taskId,
      actualCost: 0,
      requiresReview: true,
      artifact: { title: "已停止后续检查", stopped: true },
    };
  if (input.kind === "links") {
    const video = await getUserVideoConfig(
      input.userId,
      input.options.videoConfigId
    );
    if (
      !video ||
      !getVideoModelCapability(video.protocol || "openai", video.model)
        .supportsFirstLastFrame
    )
      return {
        taskId,
        actualCost: 0,
        artifact: {
          title: "所选视频模型不支持首尾帧，保留普通切镜",
          skipped: true,
        },
      };
    const candidates = prefilterLinkCandidates(scenes).filter((pair) => {
      const source = scenes.find((scene) => scene.id === pair.scene.id);
      const next = scenes.find((scene) => scene.id === pair.nextScene.id);
      // 只自动开启已知同地点、未生成视频的连续镜；不替用户撤销现有选择。
      return (
        source &&
        next &&
        !source.videoUrl &&
        !source.videoLinkNext &&
        source.imageUrl &&
        next.imageUrl &&
        source.locationKey &&
        source.locationKey === next.locationKey
      );
    });
    if (!candidates.length)
      return {
        taskId,
        actualCost: 0,
        artifact: { title: "没有需要自动开启的衔接", applied: 0 },
      };
    const config = await getUserLLMConfig(
      input.userId,
      input.options.llmConfigId
    );
    if (!config) throw new Error("请先配置文字模型");
    const raw = await chatCompletion(
      [
        { role: "system", content: LINK_SUGGEST_SYSTEM },
        { role: "user", content: buildLinkSuggestPrompt(candidates) },
      ],
      { config, temperature: 0.3, maxTokens: 2048, timeoutMs: 75_000 }
    );
    const suggestions = parseLinkSuggestOutput(raw, candidates);
    if (await isStopped(input))
      return {
        taskId,
        actualCost: 0,
        requiresReview: true,
        artifact: { title: "已停止，未应用衔接建议", stopped: true },
      };
    let applied = 0;
    let conflict = false;
    await prisma.$transaction(async (tx) => {
      for (const suggestion of suggestions) {
        const source = scenes.find((scene) => scene.id === suggestion.sceneId);
        const next = scenes.find(
          (scene) => scene.id === suggestion.nextSceneId
        );
        if (!source || !next) continue;
        // 同时锁住相邻两镜，防止模型返回时下一镜已换图仍写入旧衔接决定。
        await tx.$queryRaw`SELECT "id" FROM "Scene" WHERE "id" IN (${source.id}, ${next.id}) ORDER BY "id" FOR UPDATE`;
        const latest = await tx.scene.findMany({
          where: {
            id: { in: [source.id, next.id] },
            projectId: input.projectId,
          },
          select: {
            id: true,
            order: true,
            imageUrl: true,
            locationKey: true,
            description: true,
            actionBeat: true,
            videoUrl: true,
            videoLinkNext: true,
          },
        });
        const unchanged = [source, next].every((original) => {
          const current = latest.find((scene) => scene.id === original.id);
          return (
            current &&
            current.order === original.order &&
            current.imageUrl === original.imageUrl &&
            current.locationKey === original.locationKey &&
            current.description === original.description &&
            current.actionBeat === original.actionBeat &&
            current.videoUrl === original.videoUrl &&
            current.videoLinkNext === original.videoLinkNext
          );
        });
        if (!unchanged) {
          conflict = true;
          continue;
        }
        const changed = await tx.scene.updateMany({
          where: {
            id: source.id,
            projectId: input.projectId,
            imageUrl: source.imageUrl,
            description: source.description,
            actionBeat: source.actionBeat,
            locationKey: source.locationKey,
            videoUrl: source.videoUrl,
            videoLinkNext: source.videoLinkNext,
          },
          data: { videoLinkNext: true },
        });
        applied += changed.count;
        if (!changed.count) conflict = true;
      }
    });
    return {
      taskId,
      actualCost: 0,
      ...(conflict ? { requiresReview: true } : {}),
      artifact: { title: `已应用${applied}处连续镜衔接`, applied, suggestions },
    };
  }
  if (input.kind !== "inspect") throw new Error("检查工具参数无效");
  if (scenes.some((scene) => !scene.imageUrl))
    return {
      taskId,
      actualCost: 0,
      requiresReview: true,
      artifact: { title: "仍有分镜缺图，检查未完成" },
    };
  const config = await getUserLLMConfig(
    input.userId,
    input.options.llmConfigId
  );
  if (!config || !supportsVisionReview(config))
    throw new Error("当前文字模型不支持图像检查，请选择支持视觉的模型");
  let bible: unknown = null;
  if (project.seriesId)
    bible =
      (
        await prisma.series.findFirst({
          where: { id: project.seriesId, userId: input.userId },
          select: { storyBible: true },
        })
      )?.storyBible ?? null;
  const expectedPalette = resolveContinuityReviewPalette(project.style, bible);
  const reviewFingerprint = buildAssistantReviewFingerprint(
    project.style,
    bible,
    scenes,
    input.userId
  );
  const pairs = buildPairList(
    scenes.map((scene) => ({
      ...scene,
      characterNames: scene.sceneCharacters
        .filter((c) => c.character.userId === input.userId)
        .map((c) => c.character.name),
      outfitNotes: parseOutfitEntries(scene.characterOutfits).map(
        (entry) => `${entry.name}：${entry.outfit}`
      ),
    }))
  );
  if (!pairs.length)
    return {
      taskId,
      actualCost: 0,
      issues: [],
      artifact: {
        title: "单镜头无需相邻镜检查",
        skipped: true,
        reviewFingerprint,
      },
    };
  const results: ContinuityPairResult[] = [];
  let stopped = false;
  for (const pair of pairs) {
    if (await isStopped(input)) {
      stopped = true;
      break;
    }
    const common =
      pair.prev.characterNames?.filter((name) =>
        pair.next.characterNames?.includes(name)
      ) ?? [];
    const issues = await compareImagePairWithVision({
      prevImageUrl: pair.prev.imageUrl!,
      nextImageUrl: pair.next.imageUrl!,
      prevOrder: pair.prev.order + 1,
      nextOrder: pair.next.order + 1,
      prevLocationKey: pair.prev.locationKey,
      nextLocationKey: pair.next.locationKey,
      characterNames: common.length ? common : pair.next.characterNames,
      prevDescription: pair.prev.description,
      nextDescription: pair.next.description,
      prevOutfitNotes: pair.prev.outfitNotes,
      nextOutfitNotes: pair.next.outfitNotes,
      expectedPalette,
      llmConfig: config,
      signal: AbortSignal.timeout(75_000),
    });
    results.push({
      prevSceneId: pair.prev.id,
      nextSceneId: pair.next.id,
      nextSceneOrder: pair.next.order + 1,
      skipped: issues === null,
      issues: issues ?? [],
    });
  }
  const report = assembleContinuityReport(results);
  // 检查基于固定素材快照；用户中途换图、改台词或排序后，旧报告不能授权下一步。
  const stale =
    (await readAssistantReviewFingerprint(input.userId, input.projectId)) !==
    reviewFingerprint;
  stopped ||= await isStopped(input);
  const repair = new Map<
    string,
    { sceneId: string; anchorSceneId: string; notes: Set<string> }
  >();
  for (const issue of report.issues.filter(
    (issue) => issue.severity === "严重"
  )) {
    const entry = repair.get(issue.sceneId) ?? {
      sceneId: issue.sceneId,
      anchorSceneId: issue.prevSceneId,
      notes: new Set<string>(),
    };
    entry.notes.add(issue.fixNote);
    repair.set(issue.sceneId, entry);
  }
  // 未完整检查不能继续收费生成视频；严重问题按镜合并，避免同一图反复收费修复。
  const requiresReview =
    stale ||
    stopped ||
    report.skippedPairs > 0 ||
    results.length !== pairs.length;
  return {
    taskId,
    actualCost: 0,
    requiresReview,
    issues: stale
      ? []
      : [...repair.values()].map(({ notes, ...entry }) => ({
          ...entry,
          note: [...notes].join("；").slice(0, 1000),
        })),
    artifact: {
      title: stale
        ? "素材已变化，请重新检查"
        : stopped
          ? "视觉检查已停止"
          : report.summary,
      report,
      stale,
      stopped,
      totalPairs: pairs.length,
      reviewFingerprint,
    },
  };
}
