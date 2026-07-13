/**
 * 提示词 AI 建议 Prompt 构建（对应计划 §4 · 1.3）
 *
 * 两种场景共用一条轻量 LLM 路由：
 * - character_reference：为「生成参考图」弹窗的自定义提示词给建议；
 * - scene_iterate：为「分镜迭代生成」的追加指令 note 给建议。
 *
 * 产出 2~3 条中文短句（每条 ≤30 字），风格与对应输入框的 placeholder 示例一致
 * （如「修改发型为短发、换个表情」「把背景改成夜晚、让她笑起来」），供前端做
 * 可点选 chip → 追加进输入框。
 */

export type PromptSuggestContext = "character_reference" | "scene_iterate";

export interface PromptSuggestCharacter {
  name: string;
  gender?: string;
  age?: string;
  description?: string;
}

export interface PromptSuggestScene {
  description?: string;
  dialogue?: string;
  emotion?: string;
  shotType?: string;
}

export interface PromptSuggestInput {
  context: PromptSuggestContext;
  character?: PromptSuggestCharacter;
  scene?: PromptSuggestScene;
  /** 用户已输入的部分提示词（有则让建议围绕它延展/互补，不重复） */
  currentPrompt?: string;
}

export const PROMPT_SUGGEST_SYSTEM =
  "你是短剧 AI 绘图的提示词助手，擅长把创作意图凝练成简短可执行的调整指令。" +
  "只输出 JSON，不要任何解释或 markdown 代码块标记。";

function genderText(gender?: string): string {
  if (gender === "male") return "男";
  if (gender === "female") return "女";
  return "";
}

/** 拼接角色上下文块（character_reference 场景用） */
function buildCharacterBlock(c: PromptSuggestCharacter): string {
  const parts = [
    `角色名：${c.name}`,
    genderText(c.gender) && `性别：${genderText(c.gender)}`,
    c.age?.trim() && `年龄：${c.age.trim()}`,
    c.description?.trim() && `外貌：${c.description.trim()}`,
  ].filter(Boolean);
  return parts.join("；");
}

/** 拼接分镜上下文块（scene_iterate 场景用） */
function buildSceneBlock(s: PromptSuggestScene): string {
  const parts = [
    s.shotType?.trim() && `景别：${s.shotType.trim()}`,
    s.emotion?.trim() && `情绪：${s.emotion.trim()}`,
    s.description?.trim() && `画面：${s.description.trim()}`,
    s.dialogue?.trim() && `台词：${s.dialogue.trim()}`,
  ].filter(Boolean);
  return parts.join("；");
}

/**
 * 构建提示词建议的用户 prompt。
 *
 * 输出：{"suggestions": ["...", "...", "..."]}，2~3 条，每条中文短句 ≤30 字，
 * 是「对图片的调整指令」而非完整描述（因为要追加进已有输入框）。
 */
export function buildPromptSuggestPrompt(input: PromptSuggestInput): string {
  const currentLine = input.currentPrompt?.trim()
    ? `\n\n用户已写的提示词：「${input.currentPrompt.trim()}」。你的建议要与之互补，不要重复表达同一件事。`
    : "";

  if (input.context === "character_reference") {
    const ctx = input.character
      ? buildCharacterBlock(input.character)
      : "（无角色信息，给通用的角色定妆调整建议）";
    return `为下面这个角色的定妆参考图生成 2~3 条「调整提示词」建议，帮助用户微调角色形象。

角色信息：${ctx}${currentLine}

要求：
- 每条是一句简短的调整指令（≤30 字），如「换成温柔的微笑」「改为战斗姿态」「加一件披风」；
- 面向「角色形象/表情/服装/姿态/配饰」的调整，不要写完整外貌描述；
- 建议之间角度不同，给用户多样选择。

严格只输出如下 JSON：
{"suggestions":["建议1","建议2","建议3"]}`;
  }

  // scene_iterate
  const ctx = input.scene
    ? buildSceneBlock(input.scene)
    : "（无分镜信息，给通用的画面调整建议）";
  return `为下面这个分镜的已生成画面生成 2~3 条「迭代调整提示词」建议，帮助用户在原图基础上微调。

分镜信息：${ctx}${currentLine}

要求：
- 每条是一句简短的调整指令（≤30 字），如「把背景改成夜晚」「让她笑起来」「镜头拉远」「加强光影对比」；
- 面向「画面氛围/光线/构图/角色表情动作/背景」的调整；
- 建议之间角度不同，给用户多样选择。

严格只输出如下 JSON：
{"suggestions":["建议1","建议2","建议3"]}`;
}
