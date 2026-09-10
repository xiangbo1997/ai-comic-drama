/**
 * 半动（limited animation）导演规则 —— 视频端一致性的最低成本方案
 *
 * 核心判断：动态漫（漫剧）的主流形态就是半动——人物基本不做大幅位移，画面的「动」
 * 主要由**运镜 + 视差 + 微表情**提供。这既是动态漫的行业美学（主动选择，非妥协），
 * 也是**成本最低的一致性方案**：不给视频模型大幅重绘人物的机会，它就没法把人画崩。
 * 附带收益是生成成本更低（运动幅度小 → 模型更容易收敛 → 重试更少）。
 *
 * 与本仓既有视频 prompt 纪律的关系（不重复、不冲突）：
 * - `video-prompt.ts` 顶部已立下「身份无关」纪律：身份前缀由 provider 单独 prepend。
 *   本模块进一步把它写成**显式禁令**（NO_APPEARANCE_RESTATEMENT）——重复外貌描述会与
 *   参考图/首帧打架，反而诱发模型重画人物。
 * - 运镜词汇一律复用 13 值 `CAMERA_MOVEMENTS` 枚举（叶子模块 `camera-movements.ts`，
 *   由 `video-prompt.ts` 重导出）与其 `CAMERA_MOVEMENT_MAP` 短语表，
 *   本模块**不另起一套运镜词表**。
 *
 * 组织方式对齐 `episode-structure.ts`：导出具名常量块 + 组合函数，由消费者决定拼哪几块。
 */

import { CAMERA_MOVEMENTS, type CameraMovement } from "./camera-movements";

/**
 * ① 不重述外貌（身份交给首帧/参考图）
 *
 * I2V 的身份信息 100% 来自首帧像素，文字再描述一遍外貌只会制造「文字 vs 像素」
 * 的冲突信号，模型倾向按文字重新生成人物 → 脸变、服装变。
 */
export const NO_APPEARANCE_RESTATEMENT =
  "Do not describe or restate the character's appearance, face, hairstyle, outfit or colors in words; " +
  "the identity comes entirely from the first frame and must be preserved pixel-faithfully";

/**
 * ② 人脸只给微表情（大幅位移交给运镜）
 *
 * 允许清单刻意写得很具体（眨眼/轻笑/视线移动/发丝与布料轻晃/呼吸起伏），
 * 因为模型对「可做什么」的具体指令遵循度远高于「不要大动」这类抽象否定。
 */
export const MICRO_EXPRESSION_RULES =
  "Animate the character with micro-motion only: eye blinks, subtle gaze shifts, " +
  "slight mouth and brow movement, gentle hair and cloth sway, soft breathing rise and fall. " +
  "No large body displacement, no walking across frame, no full-body gestures, no pose changes; " +
  "any sense of large-scale movement must come from the camera, not from the character";

/**
 * ③ 多层视差位移比（前景:中景:背景 ≈ 1.5 : 1 : 0.5）+ 旋转 <5°
 *
 * 这是半动「看起来在动」的主力：分层推拉形成纵深感，而人物本体几乎静止。
 * 比例与角度上限写成具体数字，便于模型量化执行。
 */
export const PARALLAX_RULES =
  "Create depth with multi-plane parallax: foreground, midground and background drift at " +
  "relative speeds of about 1.5 : 1 : 0.5, with the foreground moving fastest. " +
  "Keep any rotation under 5 degrees; no perspective warping, no lens distortion";

/**
 * ④ 单次生成的视角 delta 限制（相机角度按 30° 档位递进）
 *
 * 超出约 30° 的视角跳变会让模型进入「没见过的角度」——此时它只能靠先验补全，
 * 于是幻觉出不存在的侧脸/后脑/服装细节。按档位递进是把一致性风险钉在可控范围内。
 */
export const CAMERA_DELTA_RULES =
  "Limit the viewpoint change within this shot: the camera angle may shift by at most one " +
  "30-degree step from the first frame. Never swing to an unseen angle of the subject " +
  "(no sudden profile-to-back turns), so the model never has to invent unseen detail";

/**
 * 半动纪律块顺序（固定）：不重述外貌 → 微表情 → 视差 → 视角 delta。
 * 顺序即权重；最关键的「别重画人」放最前。
 */
const LIMITED_ANIMATION_BLOCKS: ReadonlyArray<string> = [
  NO_APPEARANCE_RESTATEMENT,
  MICRO_EXPRESSION_RULES,
  PARALLAX_RULES,
  CAMERA_DELTA_RULES,
];

/** 半动规则块的组合选项（各块可单独关闭，便于按镜头类型裁剪） */
export interface LimitedAnimationOptions {
  /** 关闭「不重述外貌」禁令（默认 false = 注入）。极少需要关。 */
  allowAppearanceRestatement?: boolean;
  /** 关闭微表情限制（默认 false = 注入）。动作戏/打击镜可关，让模型真的动起来。 */
  allowLargeMotion?: boolean;
  /** 关闭视差指令（默认 false = 注入）。FL 首尾帧模式下插值本身提供位移，可关。 */
  skipParallax?: boolean;
  /** 关闭视角 delta 限制（默认 false = 注入）。FL 模式两端角度已由关键帧钉死，可关。 */
  skipCameraDelta?: boolean;
}

/**
 * 组合半动导演规则块。
 *
 * @param options 各规则块开关；全缺省时返回完整四块（最强一致性）
 * @returns 以 ". " 连接的英文指令串（纯 ASCII，满足 content-safety 对负面/指令段的约束）；
 *   全部关闭时返回空串，调用方据此跳过拼接。
 */
export function buildLimitedAnimationBlock(
  options?: LimitedAnimationOptions
): string {
  const keep = [
    !options?.allowAppearanceRestatement,
    !options?.allowLargeMotion,
    !options?.skipParallax,
    !options?.skipCameraDelta,
  ];
  return LIMITED_ANIMATION_BLOCKS.filter((_, i) => keep[i]).join(". ");
}

/**
 * 半动偏好的运镜子集：这些运镜在「人物几乎静止」的前提下仍能把画面撑起来。
 *
 * 取值全部来自 13 值 `CAMERA_MOVEMENTS` 枚举（类型上钉死为
 * `CameraMovement`，枚举若变更这里会直接 type-check 失败，不会静默漂移）。
 * 刻意排除 `orbit` / `tracking` / `crane` / `handheld`——环绕与跟拍会暴露
 * 参考图里不存在的角度与身体部位，是半动场景下的一致性高风险项。
 */
export const LIMITED_ANIMATION_CAMERA_MOVEMENTS: ReadonlyArray<CameraMovement> =
  [
    "static",
    "zoom_in",
    "zoom_out",
    "dolly_in",
    "dolly_out",
    "pan_left",
    "pan_right",
    "tilt_up",
    "tilt_down",
  ];

/** 半动不推荐的运镜（13 值枚举里剩下的那几个）：环绕/跟拍/摇臂/手持。 */
export const HIGH_RISK_CAMERA_MOVEMENTS: ReadonlyArray<CameraMovement> =
  CAMERA_MOVEMENTS.filter(
    (m) => !LIMITED_ANIMATION_CAMERA_MOVEMENTS.includes(m)
  );

/**
 * 判断某运镜在半动纪律下是否属高风险（会暴露参考图里没有的角度）。
 * 未知值按「非高风险」处理（宽容降级，不阻断生成）。
 */
export function isHighRiskCameraMovement(movement?: string | null): boolean {
  if (!movement) return false;
  return (HIGH_RISK_CAMERA_MOVEMENTS as ReadonlyArray<string>).includes(
    movement
  );
}
