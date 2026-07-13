/**
 * 换装定妆照的纯匹配 / 规整逻辑（无 prisma / AI 依赖，可单测）
 *
 * 从 character-look.ts 拆出：resolveCharacterLookUrl 需要 prisma / generateImage
 * （模块级会初始化 DB 客户端），而 matchClothingPreset / normalizeOutfitKey 是纯函数。
 * 单测只需纯函数时导入本文件即可，不触发 prisma 初始化（测试环境无 DATABASE_URL）。
 */

/** 服装预设（宽松版：description 可选，兼容 ClothingPreset） */
export interface LookClothingPreset {
  name: string;
  description?: string;
  imageRef?: string;
}

/**
 * outfit 文本规整为缓存键：trim + 折叠内部连续空白为单空格 + 小写。
 * 纯函数、可单测——同一套衣服（含大小写/多空格差异）归一到同一 key，
 * 保证 CharacterLook 缓存命中稳定。
 */
export function normalizeOutfitKey(outfit: string): string {
  return outfit.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 在用户预设服装里按 name 与 outfit 模糊匹配（纯函数、可单测）。
 *
 * 匹配规则（忽略首尾空白、大小写）：
 * - 全等：预设 name === outfit
 * - 互相包含：预设 name 含 outfit，或 outfit 含预设 name
 * 命中返回该预设；无命中返回 null。空/无预设返回 null。
 */
export function matchClothingPreset(
  presets: LookClothingPreset[] | null | undefined,
  outfit: string
): LookClothingPreset | null {
  if (!presets || presets.length === 0) return null;
  const target = outfit.trim().toLowerCase();
  if (!target) return null;
  for (const p of presets) {
    const name = (p.name ?? "").trim().toLowerCase();
    if (!name) continue;
    if (name === target || name.includes(target) || target.includes(name)) {
      return p;
    }
  }
  return null;
}
