/**
 * 角色定稿判定（批次 2 · 1.5）
 *
 * 「已定稿」= 角色拥有确认的定妆锚（canonicalImageUrl 非空）。
 *
 * 权威依据：canonicalImageUrl 是出图编排器实际消费的跨镜头一致性锚
 * （见 api/generate/image/route.ts buildSceneChar：`c.canonicalImageUrl || referenceImages[0]`；
 * services/generation/strategy-resolver.ts、workflow-engine.ts 同）。三视图流程与
 * 首张参考图入库都会写入该字段。CharacterReferenceAsset.isCanonical 是资产级标记，
 * 但编排器最终只认 canonicalImageUrl，故以它为准。
 *
 * 未定稿不硬阻断：仅用于批量出图 / 一键 workflow 前的提示，以及角色卡定稿徽标。
 */

/** 判定单个角色是否已定稿（定妆锚非空） */
export function isCharacterFinalized(
  character: { canonicalImageUrl?: string | null } | null | undefined
): boolean {
  return Boolean(character?.canonicalImageUrl?.trim());
}

/**
 * 从项目关联角色中挑出未定稿的角色名，供确认对话框列出。
 *
 * @param projectCharacters project.characters 形状（{ character }[]）
 * @returns 未定稿角色名数组（去重、保持顺序）
 */
export function collectUnfinalizedCharacterNames(
  projectCharacters:
    | Array<{ character: { name: string; canonicalImageUrl?: string | null } }>
    | undefined
): string[] {
  if (!projectCharacters?.length) return [];
  const names = projectCharacters
    .filter(({ character }) => !isCharacterFinalized(character))
    .map(({ character }) => character.name);
  return Array.from(new Set(names));
}
