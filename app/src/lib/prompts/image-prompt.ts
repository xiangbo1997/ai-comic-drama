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

/** 景别描述映射 */
const SHOT_MAP: Record<string, string> = {
  特写: "extreme close-up shot, face detail",
  近景: "close-up shot, head and shoulders",
  中景: "medium shot, waist up",
  全景: "full shot, entire body visible",
  远景: "wide shot, environment emphasis",
  俯拍: "high angle shot, looking down",
  仰拍: "low angle shot, looking up",
  平拍: "eye level shot",
};

export function getShotTypeDescription(shotType?: string): string {
  return SHOT_MAP[shotType || "中景"] || "medium shot";
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
