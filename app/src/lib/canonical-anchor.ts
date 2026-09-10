/**
 * 定妆锚（canonical anchor）单一真源工具。
 *
 * ## 为什么需要这个文件
 *
 * 「谁是这个角色的定妆照」在库里有**两处**记录：
 *   1. `Character.canonicalImageUrl` —— 手动出图路径（api/generate/image）与
 *      定稿判定（lib/character-finalized）读它；
 *   2. `CharacterReferenceAsset.isCanonical` —— 自动 workflow 路径
 *      （services/agents/workflow/steps/images.ts）**优先**读它，只在没有
 *      isCanonical 资产时才回退 canonicalImageUrl。
 *
 * 两处不同步时，「同一个角色」在手动路径与自动路径会锚到不同的图，跨镜头
 * 一致性随走哪条路径而变——这是最难察觉的一类 bug。因此任何改锚动作都必须
 * 经本文件的 `applyCanonicalAnchor`，它在同一事务内把两处一起改。
 *
 * 注意「改锚」不只是给新图打标，还必须**清掉旧图的 isCanonical**：
 * 否则 workflow 侧会看到两条 isCanonical 资产，按 qualityScore 排序挑出的
 * 可能仍是旧图，用户在界面上的选择被静默忽略。
 */

import type { Prisma } from "@prisma/client";

/** 三视图的 pose 取值（与 lib/three-views.ts 的 THREE_VIEW_POSES 同集合） */
const THREE_VIEW_POSE_SET = new Set(["front", "side", "back"]);

/** 参考资产的最小形状（够做锚点决策即可，避免绑死 Prisma 行类型） */
export interface AnchorCandidateAsset {
  url: string;
  pose?: string | null;
}

/**
 * 当前定妆锚是否「不是三视图之一」。
 *
 * 用途：三视图生成完成后判断要不要建议升级。判为 true 的典型场景正是线上
 * 那个问题——锚指向早期生成的角色设定拼贴图（多格视角 + 道具静物特写），
 * 它作为设定集可读，但作为喂模型的参考图会让模型不知道复现哪个视角。
 *
 * 故意**不做**图片内容检测（无法可靠判断一张图是否为拼贴），只用「锚是否
 * 在本次三视图产物里」这个确定性判据。
 */
export function isAnchorOutsideThreeViews(
  canonicalImageUrl: string | null | undefined,
  threeViewUrls: readonly string[]
): boolean {
  const anchor = canonicalImageUrl?.trim();
  if (!anchor) return false; // 无锚：走「补锚」而非「升级」，不属于本判据
  return !threeViewUrls.includes(anchor);
}

/**
 * 从三视图产物里挑出建议升级用的 URL（只认正面图）。
 *
 * 正面单人全身图是喂模型最稳的参考：视角唯一、主体唯一、无道具干扰。
 * 缺正面图时返回 undefined（不拿侧/背图凑——背影当定妆锚会让所有镜头缺脸）。
 */
export function pickCanonicalUpgradeUrl(
  views: readonly { pose: string; url: string }[]
): string | undefined {
  return views.find((v) => v.pose === "front")?.url;
}

/**
 * 判断三视图生成完成后是否该**建议**用户把锚升级为正面图。
 *
 * 三个条件全满足才建议：① 有正面图可升级；② 当前已有锚（无锚的情形由生成
 * 流程直接补锚，不必打扰用户）；③ 当前锚不在本次三视图里。
 *
 * 刻意只「建议」不「静默替换」：用户可能有意挑了别的图当锚（例如手绘定稿），
 * 自动覆盖会抹掉这个决定，而且覆盖后下次重生成会锚到本次产物、画风逐轮漂移。
 */
export function shouldSuggestCanonicalUpgrade(
  canonicalImageUrl: string | null | undefined,
  views: readonly { pose: string; url: string }[]
): { suggest: boolean; suggestedUrl?: string } {
  const suggestedUrl = pickCanonicalUpgradeUrl(views);
  if (!suggestedUrl) return { suggest: false };
  const urls = views.map((v) => v.url);
  if (!isAnchorOutsideThreeViews(canonicalImageUrl, urls)) {
    return { suggest: false };
  }
  return { suggest: true, suggestedUrl };
}

/**
 * 推断一张图被提为定妆锚时，资产行的 `pose` 该写什么。
 *
 * 已有合法 pose（三视图之一）时保留原值——把侧视图提为锚时不能谎称它是
 * 正面（朝向感知选图会据 pose 挑背影镜的参考，写错会挑错图）。
 * 无 pose 的普通参考图默认记 "front"，与 select-reference 首图补锚的既有
 * 行为一致。
 */
export function resolveAnchorPose(
  existingPose: string | null | undefined
): string {
  const pose = existingPose?.trim();
  return pose && THREE_VIEW_POSE_SET.has(pose) ? pose : "front";
}

/** 事务客户端（Prisma 事务回调入参形状） */
type TxClient = Prisma.TransactionClient;

/**
 * 在事务内把定妆锚切到 `imageUrl`，**同时**同步两处记录：
 *   - `Character.canonicalImageUrl = imageUrl`
 *   - 该角色所有 `CharacterReferenceAsset.isCanonical` 先清零，
 *     再把 url 命中的行标 true（并补 sourceType / pose）。
 *
 * 资产表里没有这张图（纯 referenceImages 里的旧数据）时补建一行，保证
 * workflow 侧「优先读 isCanonical 资产」也能拿到同一张。
 *
 * 调用方负责归属校验与 schema 容错；本函数假定 characterId 已确认属于当前用户。
 */
export async function applyCanonicalAnchor(
  tx: TxClient,
  characterId: string,
  imageUrl: string
): Promise<void> {
  // 1) 清掉旧锚标记：不清的话 workflow 侧会看到多条 isCanonical，排序后可能
  //    仍挑回旧图，用户的选择被静默忽略。
  await tx.characterReferenceAsset.updateMany({
    where: { characterId, isCanonical: true, url: { not: imageUrl } },
    data: { isCanonical: false },
  });

  // 2) 给新锚打标；资产表无此 URL 时补建一行（旧数据只在 referenceImages 里）
  const existing = await tx.characterReferenceAsset.findFirst({
    where: { characterId, url: imageUrl },
    select: { id: true, pose: true },
  });

  if (existing) {
    await tx.characterReferenceAsset.update({
      where: { id: existing.id },
      data: { isCanonical: true, pose: resolveAnchorPose(existing.pose) },
    });
  } else {
    await tx.characterReferenceAsset.create({
      data: {
        characterId,
        url: imageUrl,
        sourceType: "canonical",
        isCanonical: true,
        pose: resolveAnchorPose(null),
      },
    });
  }

  // 3) 手动路径与定稿判定读的字段
  await tx.character.update({
    where: { id: characterId },
    data: { canonicalImageUrl: imageUrl },
  });
}
