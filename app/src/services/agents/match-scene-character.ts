/**
 * 分镜角色匹配（C3）——与手动路径 scenes/route.ts 的 matchCharacterByName 同语义。
 *
 * 手动路径按分镜 characters 名单在项目角色里匹配，取首个命中 id 落库 selectedCharacterId
 * （出图角色一致性）。workflow 的 saveScenesToProject 此前漏写该字段 → 一键自动项目所有
 * 分镜 selectedCharacterId 恒 null，出图角色锚点丢失。本模块抽出纯匹配函数供 workflow 复用，
 * 保持两条路径行为一致（scenes/route.ts 不归本包，故独立实现同语义而非跨包引用）。
 */

/** 项目角色最小形状（匹配只需 id + name） */
export interface MatchableCharacter {
  id: string;
  name: string;
}

/**
 * 在项目角色里按名称匹配单个角色（三级：精确 → 角色名含输入 → 输入含角色名，均忽略大小写）。
 * 与 scenes/route.ts#matchCharacterByName 完全同序同语义。命中返回 id，否则 null。
 */
export function matchCharacterByName(
  characters: MatchableCharacter[],
  characterName: string
): string | null {
  const lower = characterName.trim().toLowerCase();
  if (!lower) return null;
  // 1. 精确匹配（忽略大小写）
  const exact = characters.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact.id;
  // 2. 模糊匹配（角色名称包含输入的名称）
  const contains = characters.find((c) => c.name.toLowerCase().includes(lower));
  if (contains) return contains.id;
  // 3. 反向模糊匹配（输入的名称包含角色名称）
  const reverse = characters.find((c) => lower.includes(c.name.toLowerCase()));
  return reverse ? reverse.id : null;
}

/**
 * 按分镜 characters 名单取首个命中的角色 id（= selectedCharacterId 落库值）。
 * 名单为空或全部未命中时返回 null。与手动路径「第一个匹配的角色用于图像生成」一致。
 */
export function resolveSelectedCharacterId(
  characters: MatchableCharacter[],
  sceneCharacterNames: readonly string[] | null | undefined
): string | null {
  for (const name of sceneCharacterNames ?? []) {
    const matched = matchCharacterByName(characters, name);
    if (matched) return matched;
  }
  return null;
}
