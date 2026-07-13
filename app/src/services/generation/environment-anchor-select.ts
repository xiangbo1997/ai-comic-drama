/**
 * 场景锚定图的纯选择逻辑（无 DB 依赖，可单测）
 *
 * 从 environment-anchor.ts 拆出：resolveEnvironmentAnchor 需要 prisma（模块级会初始化
 * DB 客户端），而 pickAnchorScene 是纯函数。单测只需纯函数时导入本文件即可，
 * 不触发 prisma 初始化（测试环境无 DATABASE_URL）。
 */

/** 当前分镜（挑锚的基准） */
export interface AnchorCurrentScene {
  id: string;
  order: number;
}

/** 候选兄弟分镜（同 projectId 同 locationKey） */
export interface AnchorSiblingScene {
  id: string;
  order: number;
  imageUrl: string | null;
}

/**
 * 从同地点兄弟分镜里挑选场景锚：取 order < 当前、imageUrl 非空、order 最小者
 * （最早出现的建立镜头，作锚最稳定——它通常是全景/远景交代空间的那一镜）。
 *
 * 纯函数、可单测：不查库，只对给定候选做筛选。无合格候选返回 null。
 */
export function pickAnchorScene(
  current: AnchorCurrentScene,
  siblings: AnchorSiblingScene[]
): { id: string; imageUrl: string } | null {
  let best: { id: string; imageUrl: string; order: number } | null = null;
  for (const s of siblings) {
    // 只锚「更早且已出图」的分镜（自身与其后的分镜不能当锚）
    if (s.order >= current.order) continue;
    if (!s.imageUrl) continue;
    if (best === null || s.order < best.order) {
      best = { id: s.id, imageUrl: s.imageUrl, order: s.order };
    }
  }
  return best ? { id: best.id, imageUrl: best.imageUrl } : null;
}
