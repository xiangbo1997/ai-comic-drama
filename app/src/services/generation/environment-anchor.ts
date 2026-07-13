/**
 * 场景锚定图（环境一致性）
 *
 * 背景：每个分镜独立出图，同一地点（locationKey 相同）的多个分镜，背景 / 空间布局 /
 * 光线各画各的、彼此漂移。ViMax 用「机位复用」保证同场景一致；这里做多级版：
 *
 *   优先级 ①「地点空景板」（ProjectLocation.imageUrl，计划 §5 · 2.2）：
 *     用户为该地点专门生成/上传的【无人物环境板】。这是治本锚——不含角色，
 *     身份/姿态不会泄漏，且不依赖「某镜已出好图」，是最理想的场景锚。
 *   优先级 ②「同地点最早出好图的兄弟镜」（ViMax 借鉴的轻量锚，既有行为）：
 *     无空景板时回落——用同 locationKey 最早已出图的那一镜当环境参考。
 *     缺点：该镜含角色，身份/姿态可能泄漏。
 *   ③ 两者皆无 → null。
 *
 * 后续镜头出图时把锚图当环境参考，锁住背景 / 布局 / 光线（角色形象仍只跟角色参考走）。
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
  /** 锚图来源：地点空景板 / 兄弟镜（供日志 / 排查与语义分流） */
  source: "location_plate" | "sibling_scene";
  /** 锚图来源分镜 id（source=sibling_scene 时有值；空景板锚无对应分镜） */
  sourceSceneId?: string;
}

/**
 * 解析当前分镜的场景锚定图（多级，优先级见文件头注释）：
 * - 查当前 scene 的 locationKey / order / projectId；无 locationKey → null。
 * - ① 查同 (projectId, locationKey) 的 ProjectLocation.imageUrl（无人物空景板）→ 命中即返回。
 * - ② 回落：查同 locationKey 的兄弟分镜，用 pickAnchorScene 挑最早已出图者。
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

    // ① 地点空景板优先（治本锚，无人物）。ProjectLocation 表缺失（旧库未 db push）
    // 时 findUnique 抛错 → 被外层 catch 吞掉回落到 null，不影响出图；已 push 的库
    // 命中空景板则直接返回。为避免表缺失影响 ② 的兄弟镜回落，这里单独 try。
    try {
      const plate = await prisma.projectLocation.findUnique({
        where: {
          projectId_locationKey: {
            projectId: scene.projectId,
            locationKey: scene.locationKey,
          },
        },
        select: { imageUrl: true },
      });
      if (plate?.imageUrl) {
        return { url: plate.imageUrl, source: "location_plate" };
      }
    } catch (plateErr) {
      log.warn("查询地点空景板失败，回落兄弟镜锚（不阻断出图）", {
        sceneId,
        error: plateErr instanceof Error ? plateErr.message : String(plateErr),
      });
    }

    // ② 回落：同地点最早已出图的兄弟镜
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

    return {
      url: anchor.imageUrl,
      source: "sibling_scene",
      sourceSceneId: anchor.id,
    };
  } catch (err) {
    log.warn("解析场景锚定图失败（不阻断出图）", {
      sceneId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
