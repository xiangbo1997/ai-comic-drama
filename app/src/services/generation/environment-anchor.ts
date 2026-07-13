/**
 * 场景锚定图（环境一致性）
 *
 * 背景：每个分镜独立出图，同一地点（locationKey 相同）的多个分镜，背景 / 空间布局 /
 * 光线各画各的、彼此漂移。ViMax 用「机位复用」保证同场景一致；这里做低成本版——
 * 同地点最早出好图的那一镜作为「场景锚定图」，后续镜头出图时把它当环境参考，
 * 锁住背景 / 布局 / 光线（角色形象仍只跟角色参考走）。
 *
 * 锚是增强项，任何异常都必须返回 null 让出图照常进行——绝不阻断。
 */

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { pickAnchorScene } from "./environment-anchor-select";

const log = createLogger("services:generation:environment-anchor");

// 纯选择逻辑拆到 environment-anchor-select.ts（无 prisma 依赖，可单测），此处再导出
export {
  pickAnchorScene,
  type AnchorCurrentScene,
  type AnchorSiblingScene,
} from "./environment-anchor-select";

/** 锚定结果 */
export interface EnvironmentAnchor {
  /** 锚图 URL */
  url: string;
  /** 锚图来源分镜 id（供日志 / 排查） */
  sourceSceneId: string;
}

/**
 * 解析当前分镜的场景锚定图：
 * - 查当前 scene 的 locationKey / order / projectId；无 locationKey → null。
 * - 查同 projectId 同 locationKey 的兄弟分镜（仅 id / order / imageUrl），
 *   用 pickAnchorScene 挑最早已出图者。
 *
 * 整体 try/catch，任何异常返回 null 并 log.warn（锚是增强项，绝不阻断出图）。
 */
export async function resolveEnvironmentAnchor(
  sceneId: string
): Promise<EnvironmentAnchor | null> {
  try {
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      select: { order: true, projectId: true, locationKey: true },
    });

    if (!scene?.locationKey) return null;

    const siblings = await prisma.scene.findMany({
      where: {
        projectId: scene.projectId,
        locationKey: scene.locationKey,
        id: { not: sceneId },
      },
      select: { id: true, order: true, imageUrl: true },
    });

    const anchor = pickAnchorScene(
      { id: sceneId, order: scene.order },
      siblings
    );
    if (!anchor) return null;

    return { url: anchor.imageUrl, sourceSceneId: anchor.id };
  } catch (err) {
    log.warn("解析场景锚定图失败（不阻断出图）", {
      sceneId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
