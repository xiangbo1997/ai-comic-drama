/**
 * 机位角度（camera angle）枚举与中文别名归一 —— 单一真源。
 *
 * ## 为什么需要
 *
 * 机位角度此前没有枚举，各路径各写各的：
 * - `script-parse.ts` 指导 LLM 输出**英文**（low-angle / high-angle…）
 * - `agent-prompts/drama-script.ts` 指导 LLM 输出**中文**（"低角度仰拍""俯视"）
 * - `video-prompt.ts` 的 `ANGLE_MODIFIER_MAP` 键**全英文**，未命中静默返回空串
 *
 * 后果：短剧创作路径（世界观→脚本→九宫格→分镜）产出的所有「低角度仰拍」
 * 在视频 prompt 里**全部消失**——用户以为设计了仰拍压迫感，成片是平视。
 * 图像端反而无碍（`prompt-builder.ts` 原样透传，中文进英文 prompt 打折但不为零）。
 *
 * 这里对齐 `camera-movements.ts` 已经做对的模式：枚举 + 中文别名表 + 归一函数，
 * 全链路单一词表。
 *
 * ## 与景别（shotType）的关系：正交
 *
 * 机位角度和景别是两个独立维度，可以组合（"俯拍中景"）。
 * ⚠️ `image-prompt.ts` 的 `SHOT_MAP` 目前混装了 5 个景别键 + 7 个机位角度键，
 * 做景别级差校验时必须把机位角度排除（`shot-sequence.ts` 已正确处理）。
 * 将来把那 7 个机位键迁到本模块后，`SHOT_MAP` 就天然只剩纯景别。
 */

/** 机位角度枚举（英文规范值，进 prompt 用） */
export const CAMERA_ANGLES = [
  "low-angle",
  "high-angle",
  "eye-level",
  "dutch-angle",
  "over-the-shoulder",
  "pov",
  "birds-eye",
  "worms-eye",
] as const;

export type CameraAngle = (typeof CAMERA_ANGLES)[number];

/**
 * 中文（及英文变体）别名 → 规范枚举值。
 *
 * 按词条长度降序匹配——否则「俯视」会被「视」之类的短词抢先命中，
 * 或「大俯拍」被「俯拍」截断后丢掉语义。这与 `shot-type-normalize.ts`
 * 的匹配纪律一致。
 */
const ANGLE_ALIASES: Record<string, CameraAngle> = {
  // 仰拍族
  低角度仰拍: "low-angle",
  低角度: "low-angle",
  仰视角: "low-angle",
  仰拍: "low-angle",
  仰视: "low-angle",
  // 俯拍族
  高角度俯拍: "high-angle",
  高角度: "high-angle",
  俯视角: "high-angle",
  俯拍: "high-angle",
  俯视: "high-angle",
  // 平视族
  水平视角: "eye-level",
  平视: "eye-level",
  平拍: "eye-level",
  // 斜角
  荷兰角: "dutch-angle",
  倾斜构图: "dutch-angle",
  斜角: "dutch-angle",
  // 过肩
  过肩镜头: "over-the-shoulder",
  过肩: "over-the-shoulder",
  // 主观
  第一人称: "pov",
  主观镜头: "pov",
  主观视角: "pov",
  主观: "pov",
  // 极端俯仰
  上帝视角: "birds-eye",
  鸟瞰: "birds-eye",
  顶视: "birds-eye",
  虫视: "worms-eye",
  极低角度: "worms-eye",
};

/** 别名按长度降序，保证长词优先命中 */
const SORTED_ALIASES = Object.keys(ANGLE_ALIASES).sort(
  (a, b) => b.length - a.length
);

const CANONICAL_SET = new Set<string>(CAMERA_ANGLES);

/**
 * 把任意写法的机位角度归一到枚举值。
 *
 * @param raw LLM 产出或用户手输的机位角度（中文/英文/空）
 * @returns 规范枚举值；无法识别返回 null（调用方按"未指定"处理，不要瞎猜）
 */
export function normalizeCameraAngle(raw?: string | null): CameraAngle | null {
  const text = raw?.trim();
  if (!text) return null;

  // 已是规范值（大小写不敏感，兼容历史上的 "POV"）
  const lower = text.toLowerCase();
  if (CANONICAL_SET.has(lower)) return lower as CameraAngle;

  // 中文别名：子串包含匹配（"低角度仰拍镜头" 也能命中）
  for (const alias of SORTED_ALIASES) {
    if (text.includes(alias)) return ANGLE_ALIASES[alias];
  }

  return null;
}

/** 供 prompt 文案列举合法值（逗号分隔的英文枚举） */
export const CAMERA_ANGLES_PROMPT_LIST = CAMERA_ANGLES.join("、");
