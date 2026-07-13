/**
 * 分镜换装的纯解析 / 匹配逻辑（无 prisma / AI 依赖，可单测）
 *
 * 从 scene-looks.ts 拆出：resolveSceneCharacterLooks 需要 prisma / character-look
 * （模块级会初始化 DB 客户端），而 parseOutfitEntries / matchOutfitToCharacter 是纯函数。
 * 单测只需纯函数时导入本文件即可，不触发 prisma 初始化（测试环境无 DATABASE_URL）。
 */

import type { SceneCharacterInfo } from "./types";

/** 单条换装标注（Scene.characterOutfits 的元素） */
export interface OutfitEntry {
  name: string;
  outfit: string;
}

/**
 * 把 scene.characterOutfits（unknown Json）安全解析为 OutfitEntry[]。
 * 纯函数、可单测：过滤掉 name/outfit 任一为空的条目；非数组返回空数组。
 */
export function parseOutfitEntries(raw: unknown): OutfitEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: OutfitEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const outfit = typeof rec.outfit === "string" ? rec.outfit.trim() : "";
    if (name && outfit) out.push({ name, outfit });
  }
  return out;
}

/**
 * 把一条换装标注按角色名匹配到本镜角色（纯函数、可单测）。
 * 全等优先（忽略首尾空白），宽松 trim 后全等兜底。无匹配返回 null。
 */
export function matchOutfitToCharacter(
  characters: SceneCharacterInfo[],
  name: string
): SceneCharacterInfo | null {
  const target = name.trim();
  if (!target) return null;
  // 全等
  const exact = characters.find((c) => c.name === target);
  if (exact) return exact;
  // 宽松 trim 后全等
  const trimmed = characters.find((c) => c.name.trim() === target);
  return trimmed ?? null;
}
