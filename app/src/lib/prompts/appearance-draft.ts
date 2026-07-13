/**
 * 角色外貌 10 字段 AI 预填 Prompt 构建（对应计划 §4 · 1.2）
 *
 * 输入角色的 name/gender/age/description（description 可空），LLM 推断出与
 * AppearanceFormData 对齐的结构化外貌 JSON，供路由做 Zod 校验 + 只填空字段回填。
 *
 * ⚠️ 语言关键约束（与 character-bible-agent 的英文 compact prompt 刻意不同）：
 * 本 prompt **必须产出中文**，且发型/发色等字段值尽量落在 UI 预设选项集合内，
 * 与用户手填中文一致，不改下游出图 prompt 拼接逻辑。落不进预设的信息放 freeText。
 */

/** 与 appearance-editor.tsx 的下拉预设保持同源（改预设时两边同步） */
export const APPEARANCE_PRESETS = {
  hairStyle: [
    "短发",
    "长直发",
    "长卷发",
    "马尾",
    "双马尾",
    "丸子头",
    "波浪卷",
    "齐刘海",
    "寸头",
    "中分",
  ],
  hairColor: [
    "黑色",
    "棕色",
    "金色",
    "红色",
    "白色",
    "银灰",
    "蓝色",
    "粉色",
    "渐变",
  ],
  faceShape: ["瓜子脸", "圆脸", "鹅蛋脸", "方脸", "心形脸", "长脸"],
  eyeColor: ["黑色", "棕色", "蓝色", "绿色", "灰色", "琥珀色", "紫色"],
  bodyType: ["纤细", "标准", "健壮", "丰满", "高挑纤细", "娇小"],
  skinTone: ["白皙", "自然肤色", "小麦色", "古铜色", "深色"],
} as const;

export interface AppearanceDraftInput {
  name: string;
  /** "male" | "female" | 其他/空 */
  gender?: string;
  age?: string;
  /** 已有外貌文字描述；为空时仅凭名字/性别/年龄推断 */
  description?: string;
}

export const APPEARANCE_DRAFT_SYSTEM =
  "你是专业的动漫角色设计师，擅长把角色文字描述拆解为结构化的外貌字段。" +
  "所有字段值必须用中文。只输出 JSON，不要任何解释或 markdown 代码块标记。";

function genderText(gender?: string): string {
  if (gender === "male") return "男";
  if (gender === "female") return "女";
  return "未指定";
}

function presetLine(label: string, options: readonly string[]): string {
  return `- ${label}（优先从这些选项里选一个）：${options.join("、")}`;
}

/**
 * 构建外貌预填的用户 prompt。
 *
 * 输出字段（10 项，与 AppearanceFormData 对齐）：
 * hairStyle/hairColor/faceShape/eyeColor/bodyType/height/skinTone/accessories/
 * freeText/clothingPresets（1 套 {name, description}）。
 *
 * 语言与预设策略：发型/发色/脸型/瞳色/体型/肤色 6 个字段尽量从预设选项集合中选，
 * 落不进预设的补充信息一律写进 freeText；height/accessories/clothing 为自由文本。
 */
export function buildAppearanceDraftPrompt(
  input: AppearanceDraftInput
): string {
  const descLine = input.description?.trim()
    ? `- 已有外貌描述：${input.description.trim()}`
    : "- 已有外貌描述：（无，请仅凭名字/性别/年龄合理推断一个符合角色气质的外貌）";

  return `请为以下角色补全结构化外貌字段，用于短剧角色定妆。

- 角色名：${input.name.trim()}
- 性别：${genderText(input.gender)}
- 年龄：${input.age?.trim() || "未指定"}
${descLine}

字段与取值要求（全部用中文）：
${presetLine("hairStyle 发型", APPEARANCE_PRESETS.hairStyle)}
${presetLine("hairColor 发色", APPEARANCE_PRESETS.hairColor)}
${presetLine("faceShape 脸型", APPEARANCE_PRESETS.faceShape)}
${presetLine("eyeColor 瞳色", APPEARANCE_PRESETS.eyeColor)}
${presetLine("bodyType 体型", APPEARANCE_PRESETS.bodyType)}
${presetLine("skinTone 肤色", APPEARANCE_PRESETS.skinTone)}
- height 身高：如「170cm」，无从判断时给一个符合年龄性别的合理值
- accessories 饰品/配件：如「圆框眼镜、红色围巾」，没有就填空字符串
- freeText 补充描述：以上预设装不下的外貌特征放这里（如特殊纹身、发饰、气质），没有就填空字符串
- clothingPresets 服装预设：给出 1 套代表性服装，格式 [{"name":"日常装","description":"具体的服装描述"}]

上述带「优先从这些选项里选」的字段，**必须**尽量选预设中的一项；确实不匹配时可另写，但会失去与界面一致的体验，请谨慎。

严格只输出如下 JSON：
{"hairStyle":"","hairColor":"","faceShape":"","eyeColor":"","bodyType":"","height":"","skinTone":"","accessories":"","freeText":"","clothingPresets":[{"name":"","description":""}]}`;
}
