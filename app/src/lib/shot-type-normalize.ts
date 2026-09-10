/**
 * 复合景别归一（景别 × 运镜正交拆分）
 *
 * 断裂背景：九宫格分镜表的 prompt（`prompts/agent-prompts/storyboard-table.ts`）
 * 明确要求 LLM 产出「景别+运镜」的复合值（如「大特写·急推」「近景·横移」），
 * 而下游三张映射表全部是**精确键匹配**且键只有标准景别：
 * - `prompts/image-prompt.ts` 的 SHOT_MAP（未命中回落 "medium shot, 50mm lens"）
 * - `prompts/video-prompt.ts` 的 FRAMING_MAP（未命中直接返回空串）
 * - `shot-timing.ts` 的 SHOT_TYPE_BASE / SHOT_TYPE_DIALOGUE_MIN（未命中回落 3 / 2）
 *
 * 结果是用户在九宫格里精心打磨的镜头语言，一路走到出图/视频 prompt 时被**静默丢弃**，
 * 全片回落成默认中景。本模块做确定性拆分，把复合值还原成两个正交字段：
 *
 *   "大特写·急推" → { shotType: "特写", cameraMovement: "dolly_in" }
 *
 * 纯函数、零依赖（除运镜枚举真源）、可单测。
 *
 * 设计约束：
 * - 运镜枚举**只从 `prompts/camera-movements.ts` 导入**，不在本文件重新定义，
 *   避免枚举漂移（该文件是解析器 / 导演增强 / Zod 校验的共同真源）。
 * - 只做归一，不做兜底猜测：无法识别的输入原样保留在 shotType（交由下游各自的
 *   既有回落逻辑处理），不臆造景别。
 */

import {
  CAMERA_MOVEMENTS,
  type CameraMovement,
} from "./prompts/camera-movements";

/**
 * 标准景别（五档，与 image-prompt.ts SHOT_MAP 前五键、shot-timing.ts 两张表同源）。
 *
 * ⚠️ 不含机位角度（俯拍/仰拍/平拍/斜角/过肩/…）——那些在 SHOT_MAP 里与景别混装，
 * 但语义上是「机位」而非「取景范围」，不参与景别识别与级差排序。
 */
const CANONICAL_SHOT_TYPES = ["特写", "近景", "中景", "全景", "远景"] as const;

/** 标准景别字面量联合类型 */
export type CanonicalShotType = (typeof CANONICAL_SHOT_TYPES)[number];

/**
 * 景别别名 → 标准景别。
 *
 * 覆盖 LLM 实际会产出的措辞变体（「大特写」「大全景」「半身」「全身」等）。
 * 匹配按**词条长度降序**进行（见 SHOT_ALIAS_ENTRIES），保证「大特写」先于「特写」
 * 命中——否则「大全景」会被「全景」抢先匹配到错误档位。
 */
const SHOT_TYPE_ALIASES: Record<string, CanonicalShotType> = {
  // 特写档
  特写: "特写",
  大特写: "特写",
  极特写: "特写",
  超特写: "特写",
  // 近景档（半身 / 胸像属于近景取景范围）
  近景: "近景",
  半身: "近景",
  半身景: "近景",
  胸像: "近景",
  中近景: "近景",
  // 中景档
  中景: "中景",
  中全景: "中景",
  // 全景档（全身即全景）
  全景: "全景",
  全身: "全景",
  全身景: "全景",
  // 远景档
  远景: "远景",
  大全景: "远景",
  大远景: "远景",
  极远景: "远景",
};

/** 别名词条按长度降序排列：保证长词（大特写）先于短词（特写）匹配 */
const SHOT_ALIAS_ENTRIES: Array<[string, CanonicalShotType]> = Object.entries(
  SHOT_TYPE_ALIASES
).sort((a, b) => b[0].length - a[0].length) as Array<
  [string, CanonicalShotType]
>;

/**
 * 运镜别名 → CameraMovement（13 值枚举内）。
 *
 * 值全部落在 CAMERA_MOVEMENTS 内（有 satisfies 断言在下方兜底），新增别名时
 * 若拼错枚举值会在类型层面报错，不会静默产出非法运镜。
 *
 * 中文运镜术语的映射依据：
 * - 「推」= 镜头向被摄体逼近。「急推/快推」是物理位移推轨（dolly_in，带背景视差，
 *   冲击力强，用于反转瞬间）；「缓推」是柔和变焦推近（zoom_in）。
 * - 「拉」= 远离被摄体（zoom_out）；「拉开/后拉」同。
 * - 「摇」= 机位不动转动镜头；中文语境默认横摇，无方向标注时取 pan_left。
 * - 「横移」= 机身平移扫过场景（pan_right，与摇区分开取右向，避免所有横向运动挤在同一值）。
 * - 「跟」= 跟随被摄体（tracking）；「升/降」= 升降臂（crane / tilt_down）。
 */
const CAMERA_MOVEMENT_ALIASES = {
  // 推（dolly_in 带视差冲击 / zoom_in 柔和变焦）
  急推: "dolly_in",
  快推: "dolly_in",
  猛推: "dolly_in",
  推近: "dolly_in",
  缓推: "zoom_in",
  慢推: "zoom_in",
  推: "zoom_in",
  // 拉
  急拉: "dolly_out",
  快拉: "dolly_out",
  缓拉: "zoom_out",
  拉开: "zoom_out",
  后拉: "zoom_out",
  拉: "zoom_out",
  // 摇 / 横移
  左摇: "pan_left",
  右摇: "pan_right",
  横摇: "pan_left",
  摇: "pan_left",
  横移: "pan_right",
  平移: "pan_right",
  // 俯仰（镜头轴向转动，非机位角度）
  上摇: "tilt_up",
  下摇: "tilt_down",
  仰摇: "tilt_up",
  俯摇: "tilt_down",
  // 跟 / 环绕 / 升降 / 手持
  跟拍: "tracking",
  跟随: "tracking",
  跟: "tracking",
  环绕: "orbit",
  绕拍: "orbit",
  升: "crane",
  升镜: "crane",
  摇臂: "crane",
  降: "tilt_down",
  手持: "handheld",
  晃动: "handheld",
  // 静止
  固定: "static",
  定格: "static",
  静止: "static",
  不动: "static",
} satisfies Record<string, CameraMovement>;

/** 运镜别名词条按长度降序：保证「急推」先于「推」命中 */
const MOVEMENT_ALIAS_ENTRIES: Array<[string, CameraMovement]> = Object.entries(
  CAMERA_MOVEMENT_ALIASES
).sort((a, b) => b[0].length - a[0].length) as Array<[string, CameraMovement]>;

/** 复合值分隔符：LLM 实际会用的各种间隔符（中点/加号/中英文逗号/斜杠/空白） */
const SEPARATOR_PATTERN = /[·・、+＋,，/／|｜\s]+/;

/**
 * 变焦箭头：LLM 会用「中景→特写」表达**镜内景别变化**（rack / 推拉过程）。
 *
 * 这类值取**箭头右侧的终点景别**：静帧出图画的是这一镜的落点画面，而箭头本身
 * 隐含了一次推近/拉远的运镜——左侧起点只用于推断运镜方向，不作为 shotType。
 */
const ARROW_PATTERN = /[→>➔➜⇒]|->|=>/;

/** parseCompositeShot 的返回形状 */
export interface ParsedShot {
  /**
   * 归一后的景别。
   * - 命中标准景别或别名 → 五档之一。
   * - 输入只有运镜（如「急推」）→ null（无景别信息，不臆造）。
   * - 完全无法识别 → 原样返回 trim 后的原串（保留用户输入，交下游既有回落处理）。
   * - 空输入 → null。
   */
  shotType: string | null;
  /** 解析出的运镜；未识别到运镜成分时为 null */
  cameraMovement: CameraMovement | null;
}

/**
 * 拆分复合景别值为「景别 + 运镜」两个正交字段。
 *
 * 例：
 * - `"大特写·急推"` → `{ shotType: "特写", cameraMovement: "dolly_in" }`
 * - `"中景"`        → `{ shotType: "中景", cameraMovement: null }`
 * - `"急推"`        → `{ shotType: null,   cameraMovement: "dolly_in" }`
 * - `"过肩"`        → `{ shotType: "过肩", cameraMovement: null }`（机位角度原样保留，
 *                      SHOT_MAP 认这个键）
 * - `null` / `""`   → `{ shotType: null,   cameraMovement: null }`
 */
export function parseCompositeShot(raw?: string | null): ParsedShot {
  const text = raw?.trim();
  if (!text) return { shotType: null, cameraMovement: null };

  // 镜内景别变化（「中景→特写·快速推近」）：取终点景别，起点只用于推断推/拉方向
  const arrowResult = parseArrowShot(text);
  if (arrowResult) return arrowResult;

  // 按分隔符切段；无分隔符时整串作为单段（仍会被子串匹配扫到）
  const segments = text.split(SEPARATOR_PATTERN).filter(Boolean);

  let shotType: CanonicalShotType | null = null;
  let cameraMovement: CameraMovement | null = null;
  /** 未被识别为景别/运镜的残留段，用于「完全无法识别」时原样回传 */
  const unmatched: string[] = [];

  for (const segment of segments) {
    const matchedShot = matchShotType(segment);
    const matchedMove = matchCameraMovement(segment);

    // 同一段可能同时含景别与运镜（如未加分隔符的「特写急推」），两者都取首次命中
    if (matchedShot && !shotType) shotType = matchedShot;
    if (matchedMove && !cameraMovement) cameraMovement = matchedMove;
    if (!matchedShot && !matchedMove) unmatched.push(segment);
  }

  // 完全无法识别（既无景别也无运镜）：原样保留输入，不臆造景别——
  // 下游 SHOT_MAP / FRAMING_MAP 仍可能认得（如「过肩」「俯拍」等机位键），
  // 认不得则各自走既有回落逻辑（并记 warn，见各调用点）。
  if (!shotType && !cameraMovement) {
    return { shotType: text, cameraMovement: null };
  }

  // 有运镜但景别段没识别出来（如「过肩·急推」）：把残留段当景别回传，
  // 让 SHOT_MAP 的机位键仍能命中，不因为拆出了运镜就丢掉机位信息。
  if (!shotType && unmatched.length > 0) {
    return { shotType: unmatched.join(""), cameraMovement };
  }

  return { shotType, cameraMovement };
}

/**
 * 处理带变焦箭头的复合值（「中景→特写·快速推近」）。
 *
 * 取箭头右侧为终点景别（静帧画的是落点）；若两侧都能识别为标准景别，则由
 * 「取景范围收窄 / 放宽」推断运镜方向（收窄=推进 dolly_in，放宽=拉远 zoom_out），
 * 显式书写的运镜（「快速推近」）优先于推断值。
 *
 * 不含箭头 → 返回 null，交由常规分段逻辑处理。
 */
function parseArrowShot(text: string): ParsedShot | null {
  if (!ARROW_PATTERN.test(text)) return null;

  const [head, ...rest] = text.split(ARROW_PATTERN);
  const tail = rest.join("");
  if (!tail.trim()) return null;

  // 终点侧可能还带着运镜后缀（「特写·快速推近」），复用常规解析
  const tailParsed = parseCompositeShot(tail);
  const startShot = matchShotType(head);
  const endShot = isCanonicalShotType(tailParsed.shotType)
    ? tailParsed.shotType
    : null;

  // 显式运镜优先；缺席时按景别档位变化推断推/拉
  let movement = tailParsed.cameraMovement;
  if (!movement && startShot && endShot) {
    const delta = shotScaleRank(endShot) - shotScaleRank(startShot);
    if (delta < 0)
      movement = "dolly_in"; // 取景收窄 = 推进
    else if (delta > 0) movement = "zoom_out"; // 取景放宽 = 拉远
  }

  return {
    shotType: endShot ?? tailParsed.shotType,
    cameraMovement: movement,
  };
}

/** 标准景别的取景档位序（特写 0 → 远景 4），仅用于推断推/拉方向 */
function shotScaleRank(shot: CanonicalShotType): number {
  return CANONICAL_SHOT_TYPES.indexOf(shot);
}

/** 单段 → 标准景别（子串匹配，长词优先）；未命中返回 null */
function matchShotType(segment: string): CanonicalShotType | null {
  for (const [alias, canonical] of SHOT_ALIAS_ENTRIES) {
    if (segment.includes(alias)) return canonical;
  }
  return null;
}

/** 单段 → 运镜枚举（子串匹配，长词优先）；未命中返回 null */
function matchCameraMovement(segment: string): CameraMovement | null {
  // 先看是否本就是合法英文枚举值（导演增强/DB 里已是标准值的情况）
  const lower = segment.toLowerCase();
  if ((CAMERA_MOVEMENTS as readonly string[]).includes(lower)) {
    return lower as CameraMovement;
  }
  for (const [alias, movement] of MOVEMENT_ALIAS_ENTRIES) {
    if (segment.includes(alias)) return movement;
  }
  return null;
}

/**
 * 只取归一后的景别（下游三张映射表的统一入口）。
 *
 * 与 parseCompositeShot 的区别：本函数丢弃运镜信息，供**只需要景别**的消费方
 * （SHOT_MAP / FRAMING_MAP / SHOT_TYPE_BASE 查表）在查表前做一次防御性归一，
 * 拦住手动输入或历史数据里的复合值。
 */
export function normalizeShotType(raw?: string | null): string | null {
  return parseCompositeShot(raw).shotType;
}

/** 判断某个值是否是标准五景别之一（级差校验用，排除机位角度键） */
export function isCanonicalShotType(
  value?: string | null
): value is CanonicalShotType {
  return (
    typeof value === "string" &&
    (CANONICAL_SHOT_TYPES as readonly string[]).includes(value)
  );
}

export { CANONICAL_SHOT_TYPES };
