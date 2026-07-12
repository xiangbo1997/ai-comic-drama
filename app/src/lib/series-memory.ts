/**
 * 系列记忆加载器（DB 触达层）。
 *
 * lib/series.ts 保持纯函数（reader/merge 规则），这里负责「查 Series.storyBible →
 * 渲染 digest」的一次 DB 往返，供 4 个注入点复用（脚本解析 / 短剧脚本 / 视频导演 /
 * 图像分析）。任何异常吞掉返回 null——记忆是增强项，绝不阻断生成。
 */

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { parseStoryBible } from "@/types/series-bible";
import { buildSeriesMemoryDigest } from "@/lib/series";

const log = createLogger("lib:series-memory");

/**
 * 按项目取系列记忆 digest。非系列项目 / 空圣经 / 异常一律返回 null。
 * @param projectId 项目 id
 * @param stage 'script'（解析/短剧，≤2000字）| 'scene'（图/视，≤600字）
 */
export async function loadSeriesMemoryDigest(
  projectId: string,
  stage: "script" | "scene"
): Promise<string | null> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { seriesId: true, episodeNumber: true },
    });
    if (!project?.seriesId) return null;

    const series = await prisma.series.findUnique({
      where: { id: project.seriesId },
      select: { storyBible: true },
    });
    if (!series) return null;

    const bible = parseStoryBible(series.storyBible);
    return buildSeriesMemoryDigest(bible, {
      stage,
      currentEpisode: project.episodeNumber ?? undefined,
    });
  } catch (err) {
    log.warn("加载系列记忆 digest 失败，按无记忆处理", {
      projectId,
      stage,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
