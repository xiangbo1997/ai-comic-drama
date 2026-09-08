/**
 * 视频/配音阶段共用的项目角色查表（从 `workflow-engine.ts` 平移，纯搬运无行为变更）
 *
 * 单一真源：video 与 audio 两个 step 模块都 import 本文件，勿各自再查一遍。
 */

import { prisma } from "@/lib/prisma";

/**
 * 一次性查询项目全部角色 + canonical 参考资产，建 name→char 查表。
 *
 * 消除 N+1（a3 审计 P0-1）：原 buildSceneCharacterContext 在视频阶段
 * `for (const dbScene of dbScenes)` 循环内每镜发一次 findMany（20 镜=20 次
 * 串行往返，各带 referenceAssets 子查询），叠在本就慢的视频阶段墙钟上。
 * 改为循环前查一次，函数内纯内存查表。
 */
export async function loadProjectCharacters(projectId: string) {
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

/** 项目角色（含 canonical 参考资产）查表：name → character，供视频阶段复用 */
export type ProjectCharacterMap = Map<
  string,
  Awaited<ReturnType<typeof loadProjectCharacters>>[number]
>;
