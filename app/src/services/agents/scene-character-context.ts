/**
 * 场景角色身份上下文（从 workflow-engine.ts 提取的纯函数）
 *
 * 提取动机：这两个函数不碰 DB / 网络 / 事件总线，只做「查表 + 拼装」，
 * 但此前埋在 1500 行的 workflow-engine 里无法单测。行为与签名保持不变，
 * workflow-engine 仍是唯一调用方（DB 查询 loadProjectCharacters 留在原处）。
 *
 * 分层：services/agents 内部模块，仅依赖同目录 types，无副作用。
 */

import type { CharacterBible, SceneArtifact } from "./types";

/** 角色查表中单条记录所需的最小结构（由 workflow-engine 的 Prisma 查询满足） */
export interface SceneCharacterEntry {
  id: string;
  name: string;
  /** Character.referenceImages[]（旧路径回退） */
  referenceImages: string[];
  /** CharacterReferenceAsset 中 isCanonical=true 的资产，已按质量排序 */
  referenceAssets: { url: string }[];
}

/** 项目角色（含 canonical 参考资产）查表：name → character */
export type ProjectCharacterMap<
  T extends SceneCharacterEntry = SceneCharacterEntry,
> = Map<string, T>;

/**
 * 把字符串稳定地映射到 [0, 2^31-1) 区间作为 identity seed。
 * 与 image-orchestrator 的 hashStringToSeed 同构（FNV-1a 32 位），保持图像/视频共享同一 seed。
 */
export function identitySeedFromCharacterId(characterId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < characterId.length; i += 1) {
    hash ^= characterId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 0x7fffffff;
}

/**
 * 构建场景级"角色身份上下文"，用于视频生成时透传：
 *
 *  - referenceImages：取每个角色的 isCanonical 参考图（优先 CharacterReferenceAsset，
 *    退到旧 Character.referenceImages[]），按 sceneArtifact.characters 顺序（primary 优先），最多 3 张
 *  - identityPrompt：拼角色 canonicalPrompt 截断（≤200 字符），用于身份维持前缀
 *  - identitySeed：FNV-1a(主角色 id)，与图像端共用
 *
 * 输入：场景 artifact 中的 characters[] (名字数组) + 项目角色查表
 * 输出：可直接喂给 generateVideo 的 { referenceImages, identityPrompt, seed }
 */
export function buildSceneCharacterContext(
  sceneArtifact: SceneArtifact,
  characterMap: ProjectCharacterMap,
  characterBible: CharacterBible | undefined
): {
  referenceImages: string[];
  identityPrompt?: string;
  seed?: number;
} {
  const characterNames = sceneArtifact.characters ?? [];
  if (characterNames.length === 0) {
    return { referenceImages: [] };
  }

  // 按 sceneArtifact.characters 的顺序排序（第一个角色 = primary），纯内存查表
  const ordered = characterNames
    .map((name) => characterMap.get(name))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  // 收集参考图：优先 referenceAssets.url，回退 Character.referenceImages[0]
  const referenceImages: string[] = [];
  for (const char of ordered) {
    if (char.referenceAssets.length > 0) {
      referenceImages.push(char.referenceAssets[0].url);
    } else if (char.referenceImages.length > 0) {
      referenceImages.push(char.referenceImages[0]);
    }
    if (referenceImages.length >= 3) break;
  }

  // identityPrompt：取主角色的 CharacterBible canonicalPrompt（前 200 字符）
  let identityPrompt: string | undefined;
  if (characterBible && ordered.length > 0) {
    const primaryName = ordered[0].name;
    const bibleEntry = characterBible.characters.find(
      (e) => e.name === primaryName
    );
    if (bibleEntry?.canonicalPrompt) {
      identityPrompt = bibleEntry.canonicalPrompt.slice(0, 200);
    }
  }

  // identitySeed：用主角色 DB id 做 FNV-1a 哈希（与 image-orchestrator 一致）
  const seed =
    ordered.length > 0 ? identitySeedFromCharacterId(ordered[0].id) : undefined;

  return { referenceImages, identityPrompt, seed };
}
