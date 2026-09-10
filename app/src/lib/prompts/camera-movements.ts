/**
 * 运镜枚举单一真源（叶子模块，不依赖任何其他 prompt 模块）
 *
 * 从 `video-prompt.ts` 提取：解析器 / 视频导演增强 / Zod 校验 / 半动规则
 * （`limited-animation.ts`）都要消费这份枚举，而 `video-prompt.ts` 又要消费半动
 * 规则块——放在原处会形成 video-prompt ↔ limited-animation 的循环 import。
 * 独立成叶子模块后依赖是单向的：两者都只向下依赖本文件。
 *
 * `video-prompt.ts` 仍重导出 `CAMERA_MOVEMENTS` / `CameraMovement`，既有调用方零改动。
 */

/**
 * 合法运镜标识符（13 值枚举）。解析器 / 导演增强 / Zod 校验共用唯一真源，
 * 避免枚举在多处漂移。顺序与 CAMERA_MOVEMENT_MAP 键一致。
 */
export const CAMERA_MOVEMENTS = [
  "static",
  "zoom_in",
  "zoom_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "dolly_in",
  "dolly_out",
  "orbit",
  "tracking",
  "handheld",
  "crane",
] as const;

/** 运镜标识符字面量联合类型 */
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number];
