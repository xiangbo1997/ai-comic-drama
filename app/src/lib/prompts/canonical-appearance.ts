/**
 * 角色「冻结外貌文本」（canonical appearance）单一真源
 *
 * 根因治理（人物不一致）：此前同一角色的外貌描述在三条出图路径上各拼一套——
 *   1. `character-reference.ts#buildAppearanceFeatures`（定妆照 / 三视图）：8 个结构化字段，不含性别年龄；
 *   2. `services/generation/strategy-resolver.ts#buildCharacterFeatures`（分镜出图）：10 字段 + description 兜底；
 *   3. `lib/prompt-builder.ts#buildEnhancedPrompt`（场景增强）：只有 性别/年龄/description，**完全忽略结构化外貌**。
 * 结果是同一件衣服在定妆照 prompt 里是 `navy blue bomber jacket`、在场景 prompt 里退化成
 * description 里的一句「蓝色夹克」，模型据此画出明显不同的人——这就是「凭记忆重写描述」
 * 在代码层的等价物。本模块把外貌文本收成一个**确定性**函数，所有出图路径共用。
 *
 * 确定性保证（可测）：
 * - 字段顺序由模块级常量 `CANONICAL_FIELD_ORDER` 固定，不依赖对象键枚举顺序 / Map 遍历顺序；
 * - 不做随机、不做截断、不读时钟、不读环境变量；
 * - 空白统一折叠（`normalizeFragment`），`" navy  blue "` 与 `"navy blue"` 产出同一串，
 *   避免用户在不同输入框里多敲一个空格就让 prompt 字符串漂移。
 *
 * 与语义稀释防治的兼容（commit 639728d）：本模块只负责「身份锚点文本」，
 * 绝不参与用户自定义指令的提权——提权仍由 `character-reference.ts#buildCustomInstructionPrefix`
 * 在 prompt 最前面完成。冻结文本永远跟在用户指令之后，不会把用户指令淹掉。
 */

import type { CharacterAppearanceInput } from "./character-reference";

/** 冻结文本的输入（与 CharacterInfo / SceneCharacterInfo / Prisma Character 结构兼容的最小子集） */
export interface CanonicalAppearanceInput {
  gender?: string | null;
  /**
   * 年龄。DB 列是 `String?`，但历史调用方存在传 number 的情况
   * （见 NormalizableFragment 注释），故如实允许 number 而非用断言绕过。
   */
  age?: string | number | null;
  /** 自由文本外貌（旧数据唯一来源；结构化字段缺失时兜底） */
  description?: string | null;
  /** 结构化外貌（CharacterAppearance 的 9 个文本字段） */
  appearance?: CharacterAppearanceInput | null;
}

/**
 * 结构化外貌字段的**固定渲染顺序 + 固定措辞**。
 *
 * 这张表就是「冻结」的实体：键的先后决定 prompt 里短语的先后，`render` 决定措辞
 * （如 eyeColor 恒为 `${value} eyes`，绝不会有时写 `eyes: blue`）。
 * 改动此表会整体改变所有历史角色的 prompt 文本 —— 属破坏性变更，需同步重生成定妆照。
 */
const CANONICAL_FIELD_ORDER: ReadonlyArray<{
  key: keyof CharacterAppearanceInput;
  render: (value: string) => string;
}> = [
  // 发色 + 发型合并成一个短语（两者都有时），与历史拼法一致
  { key: "hairColor", render: (v) => v },
  { key: "hairStyle", render: (v) => v },
  { key: "faceShape", render: (v) => v },
  { key: "eyeColor", render: (v) => `${v} eyes` },
  { key: "bodyType", render: (v) => v },
  { key: "skinTone", render: (v) => `${v} skin` },
  { key: "height", render: (v) => v },
  { key: "accessories", render: (v) => v },
  { key: "freeText", render: (v) => v },
];

/**
 * 可规范化的片段入参。
 *
 * `number` 是**如实声明**而非放宽：Prisma schema 里 `Character.age` 是
 * `String?`（schema.prisma:378），但 `age` 语义上就是数字，历史调用方存在传
 * number 的情况（旧实现 `` `${c.age} years old` `` 用模板字符串隐式 toString，
 * 对 number 天然安全，所以一直没暴露）。收口成本函数后若只按 string 处理，
 * 这些调用点会在 `.replace` 上运行时崩栈——故签名如实包含 number 并显式处理，
 * 而不是用 `String(value)` 强转掩盖。
 */
type NormalizableFragment = string | number | null | undefined;

/**
 * 片段规范化：trim + 内部连续空白折叠为单空格 + 去掉尾随逗号/分号。
 * 目的是让「语义相同但空白/标点不同」的输入产出**逐字相同**的 prompt 片段。
 *
 * number 走 `.toString()` 显式转字符串（与旧实现的模板字符串行为等价）。
 */
function normalizeFragment(value?: NormalizableFragment): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? value.toString() : value;
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,;、，；]+$/, "");
}

/** 性别关键词（确定性三分支；未知/空 → 空串，由调用方 filter 掉） */
function renderGender(gender?: NormalizableFragment): string {
  const g = normalizeFragment(gender).toLowerCase();
  if (g === "male" || g === "男") return "male";
  if (g === "female" || g === "女") return "female";
  return "";
}

/** 年龄短语（有值恒为 `${age} years old`；number 与 string 等价处理） */
function renderAge(age?: NormalizableFragment): string {
  const a = normalizeFragment(age);
  return a ? `${a} years old` : "";
}

/**
 * 结构化外貌 → 逗号短语串（不含性别/年龄）。
 *
 * 发色与发型都存在时合并为 `${hairColor} ${hairStyle}`（历史拼法，保持既有
 * 定妆照 prompt 语义），否则各自单独出现。其余字段按 CANONICAL_FIELD_ORDER 渲染。
 * 全空返回空串。
 */
export function buildCanonicalAppearanceFields(
  appearance?: CharacterAppearanceInput | null
): string {
  if (!appearance) return "";

  const hairColor = normalizeFragment(appearance.hairColor);
  const hairStyle = normalizeFragment(appearance.hairStyle);
  const fragments: string[] = [];

  for (const { key, render } of CANONICAL_FIELD_ORDER) {
    // 发色/发型特殊处理：两者齐备时在 hairColor 槽位合并输出，hairStyle 槽位跳过
    if (key === "hairColor") {
      if (hairColor && hairStyle) {
        fragments.push(`${hairColor} ${hairStyle}`);
      } else if (hairColor) {
        fragments.push(hairColor);
      }
      continue;
    }
    if (key === "hairStyle") {
      if (hairStyle && !hairColor) fragments.push(hairStyle);
      continue;
    }

    // appearance[key] 的类型即 `string | null | undefined`（CharacterAppearanceInput
    // 的 9 个字段全为该类型），normalizeFragment 可直接消费，无需类型断言。
    const value = normalizeFragment(appearance[key]);
    if (value) fragments.push(render(value));
  }

  return fragments.join(", ");
}

/**
 * 构建角色**冻结外貌文本**：同一角色、同一份数据，在任何出图路径上逐字相同。
 *
 * 组成顺序（固定）：性别 → 年龄 → 结构化外貌 → 自由文本 description。
 *
 * description 的处理是本次修复的关键：此前「有结构化外貌就丢掉 description」
 * （strategy-resolver）与「只用 description 丢掉结构化外貌」（prompt-builder）两种
 * 相反策略并存，同一角色在两条路径上拿到的是两份不同文本。这里统一为**两者都带上**
 * 且 description 垫在末尾——结构化字段精确、description 提供结构化字段覆盖不到的
 * 细节（如服装材质、气质），两者互补而非互斥。
 *
 * @param input 角色最小字段（gender/age/description/appearance）
 * @returns 逗号分隔的外貌文本；全空时返回空串（调用方按「无外貌」处理）
 */
export function buildCanonicalAppearanceText(
  input: CanonicalAppearanceInput
): string {
  const fields = buildCanonicalAppearanceFields(input.appearance);
  const description = normalizeFragment(input.description);

  return [renderGender(input.gender), renderAge(input.age), fields, description]
    .filter(Boolean)
    .join(", ");
}

/**
 * 带角色名的冻结外貌条目：`名字: <冻结文本>`（可选 `(main character)` 标注）。
 * 多角色场景用它逐角色生成条目，保证每个角色的描述块格式也是冻结的。
 *
 * @param name 角色名（原样保留，不做翻译/规范化——名字本身就是身份锚）
 * @param input 角色外貌字段
 * @param roleLabel 可选角色标注（如 "(main character)"）
 * @returns `名字(标注): 外貌文本`；外貌文本为空时返回 `名字(标注)`（仍保留名字锚点）
 */
export function buildCanonicalCharacterEntry(
  name: string,
  input: CanonicalAppearanceInput,
  roleLabel?: string
): string {
  const label = roleLabel ? `${name}${roleLabel}` : name;
  const text = buildCanonicalAppearanceText(input);
  return text ? `${label}: ${text}` : label;
}

/**
 * 画风 + 打光的「同项目内不漂移」锁定句。
 *
 * 与外貌同理：画风/打光措辞在不同镜头间换写法（这镜 "soft rim light"、下镜
 * "backlit"）会让同一场戏的光位和材质跳变。这里给一句显式锁定指令，把「项目级
 * 画风与打光是固定的、不得逐镜重新诠释」写进 prompt。
 *
 * 注意：本句**不重复**具体画风/打光内容（那由 style-packs 的 anchor 与
 * getLightingPrefix 各自注入一次），只声明「别改」，避免二次描述反而引入漂移。
 */
export const STYLE_LIGHTING_LOCK =
  "Keep the art style, line quality, shading method and lighting setup identical to the rest of this project; " +
  "do not reinterpret the visual style or relight the scene";
