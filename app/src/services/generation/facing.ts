/**
 * 朝向感知的三视图参考图选择（规则级，零 LLM 成本）
 *
 * 背景：角色的三视图参考图（CharacterReferenceAsset.pose = front|side|back|3quarter）
 * 此前全部塞进参考列表，没有按分镜里角色的朝向挑选。若这一镜角色是背影，却拿正面
 * 定妆图当参考，模型容易被参考图的正脸拉回正面、与画面描述冲突。
 *
 * 本模块做保守的关键词推断：只在文本明确出现「背对/侧面」信号时才偏离默认正面，
 * 避免误命中把大量正面镜头判成侧/背。纯函数、可单测、无副作用。
 */

/** 角色在画面中的朝向 */
export type Facing = "front" | "side" | "back";

/** 朝向推断的输入线索（分镜画面描述 + 镜头角度 + 构图） */
export interface FacingHints {
  description?: string | null;
  cameraAngle?: string | null;
  composition?: string | null;
}

/**
 * 背对信号：命中即判 back（背影 / 背对 / 从背后拍）。
 * 只收显式信号：裸 /离去/、/走远/ 这类宽松词会把「她望着他离去」的旁观视角
 * 误判成背面（facing 是场景级的，会波及镜内所有角色），故不收。
 */
const BACK_PATTERNS: RegExp[] = [
  /背对/,
  /背影/,
  /转身离去/,
  /转身走/,
  /\bback to camera\b/i,
  /\bfrom behind\b/i,
  /\bwalking away\b/i,
  /\brear view\b/i,
];

/**
 * 侧面信号：命中即判 side。profile 用词边界（\bprofile\b）防止误命中
 * "profile picture" 之外的场景——这里只关心「侧脸/侧身」语义。
 */
const SIDE_PATTERNS: RegExp[] = [
  /侧脸/,
  /侧面/,
  /侧身/,
  /侧影/,
  /\bprofile\b/i,
  /\bside view\b/i,
  /\bin profile\b/i,
];

/**
 * 从画面线索推断角色朝向。保守规则：
 * 1. 任一线索命中背对信号 → back（优先级最高，背影最需换背视图）
 * 2. 命中侧面信号 → side
 * 3. 默认 front（绝大多数镜头是正面 / 正 3/4 面）
 */
export function inferFacing(hints: FacingHints): Facing {
  const haystack = [hints.description, hints.cameraAngle, hints.composition]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n");

  if (!haystack) return "front";

  if (BACK_PATTERNS.some((re) => re.test(haystack))) return "back";
  if (SIDE_PATTERNS.some((re) => re.test(haystack))) return "side";
  return "front";
}

/** 参考图资产（url + 可选 pose） */
export interface FacingAsset {
  url: string;
  pose?: string | null;
}

/**
 * 按朝向从角色的参考资产里挑选最合适的一张 URL。
 *
 * 优先级：
 * 1. pose 与目标朝向完全匹配（back→back / side→side / front→front）
 * 2. side 无匹配时回退 3quarter（3/4 侧比正面更贴近侧面语义）
 * 3. 再回退 front（正面定妆是最通用的身份锚）
 * 4. 再回退第一张（至少有图）
 *
 * 无资产时返回 undefined，由调用方回落既有 canonicalImageUrl 逻辑（零回归）。
 */
export function pickAssetUrlForFacing(
  assets: FacingAsset[],
  facing: Facing
): string | undefined {
  if (assets.length === 0) return undefined;

  const byPose = (pose: string): string | undefined =>
    assets.find((a) => a.pose === pose)?.url;

  // 1. 完全匹配
  const exact = byPose(facing);
  if (exact) return exact;

  // 2. side 回退 3quarter
  if (facing === "side") {
    const threeQuarter = byPose("3quarter");
    if (threeQuarter) return threeQuarter;
  }

  // 3. 回退 front
  const front = byPose("front");
  if (front) return front;

  // 4. 回退第一张
  return assets[0]?.url;
}
