/**
 * 图像生成 Prompt 模板
 *
 * 风格前缀统一从 style-packs.ts 的画风包（StylePack）派生——单一真源。
 * 原 STYLE_MAP / SIMPLE_STYLE_MAP 已折进画风包，避免多处重复的风格规则文本。
 */

import { getStylePack } from "./style-packs";

/** 风格前缀：取画风包的英文锚定词（anchor）。未知 style 由 getStylePack 回落 anime。 */
export function getStylePrefix(style?: string): string {
  return getStylePack(style).anchor;
}

/**
 * 景别 × 机位 × 光学映射
 *
 * 每个值带上焦段与景深描述，把「特写/近景」这类抽象景别翻译成模型能理解的
 * 镜头语言（焦距 + 光圈景深 + 视角），出图才有真正的电影镜头感而非平铺直叙。
 * 键向后兼容原 8 个（特写/近景/中景/全景/远景/俯拍/仰拍/平拍），
 * 并补充过肩/斜角/低角冲击/高角压迫等常用机位。
 */
const SHOT_MAP: Record<string, string> = {
  // 景别（焦段 + 景深）
  特写: "extreme close-up shot, 85mm lens, shallow depth of field, face and eyes detail, background bokeh",
  近景: "close-up shot, 85mm portrait lens, head and shoulders, soft shallow depth of field",
  中景: "medium shot, 50mm lens, waist up, natural perspective, moderate depth of field",
  全景: "full shot, 35mm lens, entire body visible, balanced depth of field",
  远景: "wide establishing shot, 24mm wide-angle lens, environment emphasis, deep focus, subject small in frame",
  // 机位（角度 + 光学效果）
  俯拍: "high angle shot, camera looking down, oppressive top-down perspective, subject appears diminished",
  仰拍: "low angle shot, camera looking up, heroic impactful perspective, towering subject",
  平拍: "eye level shot, 50mm lens, neutral natural perspective",
  斜角: "dutch angle shot, tilted canted frame, unsettling dynamic tension",
  过肩: "over-the-shoulder shot, foreground shoulder blur, 85mm lens, layered depth",
  低角冲击:
    "dramatic low-angle impact shot, wide-angle distortion, dynamic upward perspective, exaggerated foreground",
  高角压迫:
    "high-angle oppression shot, steep top-down view, subject small and vulnerable, looming negative space",
};

export function getShotTypeDescription(shotType?: string): string {
  return SHOT_MAP[shotType || "中景"] || "medium shot, 50mm lens";
}

/**
 * 灯光预设映射（借鉴 open-storyboard-canvas 的 lighting preset 思路）
 *
 * key 同时接受中文别名与英文 key，值为成熟的电影级布光英文片段。
 * 用于把 SceneScript.lighting / 用户选择的灯光预设翻译成模型可理解的描述，
 * 避免出现裸数值（如 "azimuth 270°"，模型会忽略甚至画出实体灯具）。
 */
const LIGHTING_MAP: Record<string, string> = {
  伦勃朗光:
    "Rembrandt lighting, 45-degree key light, dramatic chiaroscuro, painterly shadows",
  rembrandt:
    "Rembrandt lighting, 45-degree key light, dramatic chiaroscuro, painterly shadows",
  黄金时刻:
    "golden hour lighting, warm soft sunlight, long gentle shadows, glowing rim light",
  "golden-hour":
    "golden hour lighting, warm soft sunlight, long gentle shadows, glowing rim light",
  日落: "sunset lighting, warm orange and pink tones, soft directional backlight",
  sunset:
    "sunset lighting, warm orange and pink tones, soft directional backlight",
  赛博朋克:
    "cyberpunk neon lighting, synthetic glow, vibrant cyan and magenta neon, high contrast",
  cyberpunk:
    "cyberpunk neon lighting, synthetic glow, vibrant cyan and magenta neon, high contrast",
  蓝色逆光:
    "blue backlight, cool rim light separating subject from background, moody atmosphere",
  "blue-backlight":
    "blue backlight, cool rim light separating subject from background, moody atmosphere",
  神秘: "mysterious low-key lighting, deep shadows, single soft light source, suspenseful mood",
  mysterious:
    "mysterious low-key lighting, deep shadows, single soft light source, suspenseful mood",
  过曝: "overexposed high-key lighting, bright airy washed-out tones, minimal shadows",
  overexposed:
    "overexposed high-key lighting, bright airy washed-out tones, minimal shadows",
  诺兰灰:
    "Nolan-style desaturated grey lighting, naturalistic cinematic tone, muted palette",
  "nolan-grey":
    "Nolan-style desaturated grey lighting, naturalistic cinematic tone, muted palette",
};

/**
 * 取灯光描述。传入中文/英文 key 或直接传一段自由文本（如 LLM 输出的 lighting 字段）。
 * - 命中预设 → 返回标准布光片段；
 * - 未命中但有内容 → 原样返回（视为 LLM 已给出的自然语言光线描述）；
 * - 空 → 返回空串（由调用方 filter 掉）。
 */
export function getLightingPrefix(lighting?: string | null): string {
  if (!lighting) return "";
  const trimmed = lighting.trim();
  return LIGHTING_MAP[trimmed] || trimmed;
}

/**
 * 分级身份/构图一致性护栏（正向约束，借鉴 open-storyboard-canvas MultiAnglePanel）
 *
 * 单人镜头：锁定面部特征、发型、服装剪影；
 * 多人镜头：在单人基础上叠加"保持人数 / 左右顺序 / 不增减不克隆不互换"，
 * 专治多人场景的人数漂移、换脸、角色合并等高频问题。
 *
 * @param characterCount 画面内角色数量（来自场景选中的角色）
 */
export function buildConsistencyGuard(characterCount: number): string {
  const single =
    "preserve the same face identity, facial structure, hairstyle, and clothing silhouette";
  if (characterCount <= 1) {
    return `IMPORTANT: ${single}`;
  }
  return [
    `IMPORTANT: keep exactly ${characterCount} people`,
    "preserve left-right order and each person's identity",
    single,
    "no extra people, no duplicated or cloned faces, no identity swapping, no merged characters",
  ].join(", ");
}

/**
 * 简易 prompt 风格前缀（短前缀语义：取画风包 anchor 的首个子句 + 尾随逗号）。
 *
 * 用于 script.ts / grid / tail-frame / character-look 等需要「轻量风格提示」的场景：
 * 只取锚定词的第一段（避免整段冗长锚词压制主体描述），末尾补逗号便于拼接。
 * 与 getStylePrefix 同源于画风包，未知 style 回落 anime。
 */
export function getSimpleStylePrefix(style: string): string {
  const anchor = getStylePack(style).anchor;
  const firstClause = anchor.split(",")[0]?.trim() || anchor;
  return `${firstClause},`;
}
