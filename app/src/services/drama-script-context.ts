/**
 * 短剧脚本的上下文推导（题材回落 + 系列前情记忆）。
 *
 * 这两个函数原本是 `api/projects/[id]/drama-script/route.ts` 的模块私有函数。
 * MCP 剧本工作台要走同一条脚本生成路径，若各自复制一份，题材回落规则与系列记忆
 * 优先级就会在两条路径上各改各的（本仓库明令禁止的双路径漂移）。故原样抽到
 * services 层，Web route 与 MCP 共用同一份实现——逻辑逐字未改，仅改变所在文件。
 */

import { prisma } from "@/lib/prisma";
import { buildPreviousEpisodeRecap } from "@/lib/series";
import { loadSeriesMemoryDigest } from "@/lib/series-memory";

/**
 * 读取项目已存的题材（generationParams.genre，批 3）。
 *
 * generationParams 是 Prisma Json 列，运行时形状不受类型保护，故逐层做类型收窄；
 * 非对象 / 非字符串 / 空串一律返回 undefined（调用方按「无题材」处理，零回归）。
 */
export function readStoredGenre(project: {
  generationParams: unknown;
}): string | undefined {
  const params = project.generationParams;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  const genre = (params as Record<string, unknown>).genre;
  if (typeof genre !== "string") return undefined;
  return genre.trim() || undefined;
}

/**
 * 系列第 N>1 集：生成注入本集脚本 prompt 的前情/记忆上下文。
 *
 * 优先用故事圣经 digest（累积记忆：主题锁/未解决伏笔/角色状态/近 3 集回顾），
 * 覆盖 1..N-1 全部集数；圣经为空（老系列尚未归档）时回落到旧的「上一集前情提要」
 * （仅 N-1 集的 logline + 结尾场景）。独立项目/第 1 集返回 undefined。
 */
export async function derivePreviousEpisodeRecap(project: {
  id: string;
  seriesId: string | null;
  episodeNumber: number | null;
}): Promise<string | undefined> {
  if (
    !project.seriesId ||
    project.episodeNumber == null ||
    project.episodeNumber <= 1
  ) {
    return undefined;
  }

  // 优先：累积故事圣经 digest（覆盖全部前作，非仅上一集）
  const digest = await loadSeriesMemoryDigest(project.id, "script");
  if (digest) return digest;

  // 回落：pre-bible 老系列，用旧的上一集前情提要
  const prev = await prisma.project.findFirst({
    where: {
      seriesId: project.seriesId,
      episodeNumber: { lt: project.episodeNumber },
    },
    orderBy: { episodeNumber: "desc" },
    select: { id: true, title: true, episodeNumber: true },
  });
  if (!prev) return undefined;

  const script = await prisma.shortDramaScript.findFirst({
    where: { projectId: prev.id },
    orderBy: { updatedAt: "desc" },
    select: { filmTitle: true, scriptDoc: true },
  });
  const doc = script?.scriptDoc as {
    logline?: unknown;
    scenes?: Array<{
      description: string;
      dialogue: string | null;
      narration: string | null;
    }>;
  } | null;
  if (doc?.scenes && doc.scenes.length > 0) {
    return (
      buildPreviousEpisodeRecap({
        episodeNumber: prev.episodeNumber,
        title: script?.filmTitle ?? prev.title,
        logline: typeof doc.logline === "string" ? doc.logline : null,
        endingScenes: doc.scenes.slice(-2),
      }) ?? undefined
    );
  }

  const lastScenes = await prisma.scene.findMany({
    where: { projectId: prev.id },
    orderBy: { order: "desc" },
    take: 2,
    select: { description: true, dialogue: true, narration: true },
  });
  if (lastScenes.length === 0) return undefined;
  return (
    buildPreviousEpisodeRecap({
      episodeNumber: prev.episodeNumber,
      title: prev.title,
      logline: null,
      endingScenes: [...lastScenes].reverse(),
    }) ?? undefined
  );
}
