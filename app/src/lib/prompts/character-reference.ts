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

/**
 * 三视图视角约束词：注入 prompt 强制生成对应角度。
 *
 * ⚠️ 措辞禁忌（血泪教训）：绝不能出现 "character sheet" / "turnaround" /
 * "reference sheet" 等词——这些在图像模型语料里字面等于「一张纸上排布多姿势
 * 的拼版设定稿」，会让模型把单个视角画成 3×3 九宫格。改为显式要求
 * SINGLE_SUBJECT（单只角色、单一视角、单张图、居中、纯白背景）。
 */
export const POSE_CONSTRAINTS: Record<"front" | "side" | "back", string> = {
  front: "front view, facing the camera directly, standing upright pose",
  side: "side view, facing left in full profile, standing upright pose",
  back: "back view, seen from directly behind, standing upright pose",
};

/**
 * 单主体约束：与 POSE_CONSTRAINTS 配合，锁死「一张图=一只角色的一个角度」。
 * 防止模型输出角色设定稿式的多姿势拼版（九宫格）。
 */
export const SINGLE_SUBJECT =
  "a single full-body character, one subject only, one single pose, " +
  "centered composition, isolated on a plain white background, " +
  "no grid, no collage, no multiple poses, not a character reference sheet";

/**
 * 三视图负向提示：双向防九宫格。flow2api(gemini) 会把它以自然语言
 * "Avoid the following elements" 注入；FLUX/SDXL 系原生 negative_prompt 消费。
 */
export const THREE_VIEW_NEGATIVE =
  "character sheet, reference sheet, turnaround sheet, grid, collage, " +
  "multiple poses, multiple views, multiple characters, split panels, tiled images, contact sheet";

/**
 * 身份锁定指令：带参考图（i2i）生成三视图时追加，强制「保形 + 仅换角度」。
 *
 * 根因治理：三视图曾以文字重画角色，与主图不一致。改为 i2i 后，若不显式
 * 约束，模型仍可能「参考风格但重新设计角色」。这句把参考图钉为**同一角色**，
 * 只允许角度/姿势变化，禁止改动脸型/发色/配色/服装/画风。
 */
export const IDENTITY_LOCK =
  "keep the exact same character identity as the reference image: " +
  "same face, hairstyle, hair color, body proportions, outfit, color palette and art style; " +
  "only change the viewing angle and pose, do not redesign the character";
