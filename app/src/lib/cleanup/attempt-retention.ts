/**
 * GenerationAttempt 按分镜保留期裁剪（数据生命周期，2026-09-08）
 *
 * 背景：迭代式出图每按一次「重新生成」就写一条 GenerationAttempt（带
 * outputUrl 指向一张真实存储文件）。该表只增不删——admin/cleanup 虽会删
 * 30 天前终结的 GenerationTask（attempt 随 taskId 级联），但分镜维度的
 * 历史版本（sceneId 关联、供「按分镜列所有历史版本」回退）会一直堆到
 * 项目被删为止：一个反复打磨的分镜攒上百条 attempt + 上百张孤儿图很常见。
 *
 * 策略：按分镜保留最近 keepPerScene 条，超出的从旧到新删除，并同步删除
 * 其 outputUrl 对应的存储文件。isCurrent=true 的版本（分镜当前选中版本）
 * 永不删除——即使它很老，删掉会让「当前版本」在历史列表里消失。
 *
 * 调用方：/api/admin/cleanup（外部定时器每小时打一次）。
 */

import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/services/storage";
import { createLogger } from "@/lib/logger";
import {
  selectAttemptsToPrune,
  type PrunableAttempt,
} from "@/lib/cleanup/select-attempts-to-prune";

export { selectAttemptsToPrune };
export type { PrunableAttempt };

const log = createLogger("lib:cleanup:attempt-retention");

/** 每个分镜默认保留的历史版本数 */
const DEFAULT_KEEP_PER_SCENE = 20;
/** 单次执行处理的分镜数上限（防一次跑太久拖住 cleanup 端点） */
const DEFAULT_BATCH = 500;

export interface PruneSceneAttemptsOptions {
  /** 每个分镜保留的历史版本数（默认 20） */
  keepPerScene?: number;
  /** 单次处理的分镜数上限（默认 500） */
  batch?: number;
}

export interface PruneSceneAttemptsResult {
  /** 被扫描（超出保留数）的分镜数 */
  scannedScenes: number;
  /** 删除的 attempt 行数 */
  deletedAttempts: number;
  /** 成功删除的存储文件数 */
  deletedFiles: number;
  /** 删除失败的存储文件数（成孤儿，仅记日志） */
  failedFiles: number;
}

/**
 * 按分镜裁剪 GenerationAttempt 历史版本，并清理其存储文件。
 *
 * 删库成功后才删文件；文件删除失败只记日志（孤儿可后续批量清理），
 * 不影响返回值中的 deletedAttempts 计数。
 */
export async function pruneSceneAttempts({
  keepPerScene = DEFAULT_KEEP_PER_SCENE,
  batch = DEFAULT_BATCH,
}: PruneSceneAttemptsOptions = {}): Promise<PruneSceneAttemptsResult> {
  const result: PruneSceneAttemptsResult = {
    scannedScenes: 0,
    deletedAttempts: 0,
    deletedFiles: 0,
    failedFiles: 0,
  };

  // 先用 groupBy 找出「attempt 条数超过保留数」的分镜，避免全表拉取。
  // sceneId 为 null 的 attempt（非迭代式出图路径）不在此裁剪范围，
  // 它们随 GenerationTask 30 天保留期级联删除。
  // Prisma 要求 groupBy 带 take 时必须给 orderBy；按 sceneId 排序即可，
  // 只是为了让分批结果稳定（本次没处理完的下轮 cron 继续）。
  const overflowing = await prisma.generationAttempt.groupBy({
    by: ["sceneId"],
    where: { sceneId: { not: null } },
    _count: { _all: true },
    having: { id: { _count: { gt: keepPerScene } } },
    orderBy: { sceneId: "asc" },
    take: batch,
  });

  for (const group of overflowing) {
    const sceneId = group.sceneId;
    if (!sceneId) continue;

    const attempts = await prisma.generationAttempt.findMany({
      where: { sceneId },
      select: {
        id: true,
        createdAt: true,
        isCurrent: true,
        outputUrl: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const toPrune = selectAttemptsToPrune(attempts, keepPerScene);
    if (toPrune.length === 0) continue;

    result.scannedScenes += 1;

    const deleted = await prisma.generationAttempt.deleteMany({
      where: { id: { in: toPrune.map((a) => a.id) } },
    });
    result.deletedAttempts += deleted.count;

    // 存储清理：仅删本次真正删掉的行所引用的文件。同一 URL 可能被多条
    // attempt 共用（同图重试落同一 URL），去重后再删；仍被保留行引用的
    // URL 跳过，避免删掉历史列表里还看得见的图。
    //
    // 还要额外排除 Scene 三态 URL：分镜当前展示的图/视频就是某次 attempt 的
    // outputUrl（isCurrent 未必维护到位），删掉会让编辑器里的成图变成裂图。
    // 当前版本的真相是 Scene.imageUrl（见 schema 注释），故以它为准再兜一层。
    const prunedIds = new Set(toPrune.map((p) => p.id));
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      select: { imageUrl: true, videoUrl: true, audioUrl: true },
    });
    const keptUrls = new Set(
      [
        ...attempts.filter((a) => !prunedIds.has(a.id)).map((a) => a.outputUrl),
        scene?.imageUrl,
        scene?.videoUrl,
        scene?.audioUrl,
      ].filter((u): u is string => Boolean(u))
    );
    const urls = [
      ...new Set(
        toPrune
          .map((a) => a.outputUrl)
          .filter((u): u is string => Boolean(u) && !keptUrls.has(u as string))
      ),
    ];

    const settled = await Promise.allSettled(urls.map((u) => deleteFile(u)));
    for (const s of settled) {
      if (s.status === "fulfilled") result.deletedFiles += 1;
      else result.failedFiles += 1;
    }
  }

  if (result.deletedAttempts > 0 || result.failedFiles > 0) {
    log.info(
      `裁剪分镜历史版本：${result.scannedScenes} 个分镜、删除 ${result.deletedAttempts} 条 attempt、` +
        `清理 ${result.deletedFiles} 个文件（${result.failedFiles} 个失败成孤儿）`
    );
  }

  return result;
}
