/**
 * 角色参考图 Prompt 构建（单图 / 三视图共用）
 *
 * 从 generate-reference 路由提取，保证单图生成与三视图生成的 prompt 一致。
 */

/**
 * 构建角色 prompt 所需的最小字段（与 Prisma Character + tags 结构兼容）。
 * tags 元素的 tag 用 name 字段 + 索引签名，兼容 Prisma tag 的多余字段。
 */
export interface CharacterPromptInput {
  name: string;
  gender?: string | null;
  age?: string | null;
  description?: string | null;
  tags?: { tag: { name: string } }[];
}

/**
 * 构建角色基础提示词（性别关键词前置 + 名称 + 年龄 + 外貌 + 风格标签 + 质量词）。
 * 与原 generate-reference 路由的拼接逻辑等价。
 */
export function buildCharacterBasePrompt(
  character: CharacterPromptInput
): string {
  const genderText =
    character.gender === "male"
      ? "1man, male, masculine, handsome man, male character, boy"
      : character.gender === "female"
        ? "1woman, female, feminine, beautiful woman, female character, girl"
        : "";

  const ageText = character.age ? `${character.age} years old` : "";

  // 提取标签名称（排除性别标签，避免重复）
  const tagNames =
    character.tags
      ?.map((ct) => ct.tag.name)
      .filter(
        (name) =>
          name !== "男" && name !== "女" && name !== "male" && name !== "female"
      ) || [];
  const tagsText = tagNames.length > 0 ? tagNames.join(", ") : "";

  return [
    genderText, // 第一优先级：多个性别关键词
    character.name,
    ageText,
    character.description || "",
    tagsText,
    "detailed face, clean background, masterpiece",
  ]
    .filter(Boolean)
    .join(", ");
}

/** 三视图视角约束词：注入 prompt 强制生成对应角度 */
export const POSE_CONSTRAINTS: Record<"front" | "side" | "back", string> = {
  front:
    "front view, facing camera, full body character sheet, T-pose, symmetrical",
  side: "side view, full body profile, character turnaround",
  back: "back view, from behind, full body, character turnaround",
};
