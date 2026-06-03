/**
 * 三视图工具：从角色参考资产中按 pose 提取正/侧/背三视图。
 *
 * 供两处复用：① 角色卡独立三联展示；② 生视频时作为多参考图锁形象。
 */

/** 参考资产的最小形状（兼容 Prisma CharacterReferenceAsset 与前端类型） */
export interface PosedAsset {
  url: string;
  pose?: string | null;
  createdAt?: string | Date;
}

export const THREE_VIEW_POSES = ["front", "side", "back"] as const;
export type ThreeViewPose = (typeof THREE_VIEW_POSES)[number];

/**
 * 从资产列表中提取最新的一组三视图（front/side/back 各取最新一张）。
 * 返回 { front?, side?, back? }，缺某个角度则该字段为 undefined。
 */
export function extractThreeViews(
  assets: PosedAsset[] | undefined | null
): Record<ThreeViewPose, string | undefined> {
  const result: Record<ThreeViewPose, string | undefined> = {
    front: undefined,
    side: undefined,
    back: undefined,
  };
  if (!assets?.length) return result;

  // assets 已按 createdAt desc 排序时，第一个匹配即最新；这里不假定顺序，显式按时间挑最新
  const ts = (a: PosedAsset) =>
    a.createdAt ? new Date(a.createdAt).getTime() : 0;

  for (const pose of THREE_VIEW_POSES) {
    const matched = assets
      .filter((a) => a.pose === pose)
      .sort((a, b) => ts(b) - ts(a));
    result[pose] = matched[0]?.url;
  }
  return result;
}

/**
 * 取角色的三视图 URL 数组（用于生视频多参考图）。
 * 顺序：front, side, back，仅包含存在的。无三视图时返回空数组。
 */
export function getThreeViewUrls(
  assets: PosedAsset[] | undefined | null
): string[] {
  const views = extractThreeViews(assets);
  return THREE_VIEW_POSES.map((p) => views[p]).filter((url): url is string =>
    Boolean(url)
  );
}

/** 是否拥有完整三视图（正/侧/背都有） */
export function hasCompleteThreeViews(
  assets: PosedAsset[] | undefined | null
): boolean {
  const views = extractThreeViews(assets);
  return Boolean(views.front && views.side && views.back);
}
