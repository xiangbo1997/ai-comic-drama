/**
 * 世界观 AI 起草 Prompt 构建（对应计划 §4 · 1.1）
 *
 * 用户只写一句话想法（+可选题材），LLM 扩写为适合竖屏短剧的完整世界观、
 * 主角身份、类型、片名。产出为结构化 JSON，供路由做 Zod 校验 + 回填表单。
 *
 * 与 drama-script-agent 的区别：那个吃「已完整的世界观」产出分镜脚本；
 * 本 prompt 是它的上游——把「空白想法」变成「可编辑的世界观草稿」，
 * 消除用户的「空白页恐惧」。
 */

export interface WorldviewDraftInput {
  /** 一句话想法（必填，如「重生复仇爽剧，女主是被陷害的豪门千金」） */
  idea: string;
  /** 可选题材倾向（如「玄幻」「都市」），留空时由 LLM 判断 */
  genre?: string;
  /** 可选系列上下文（续集时注入前情，保证世界观衔接） */
  seriesContext?: string;
}

export const WORLDVIEW_DRAFT_SYSTEM =
  "你是资深竖屏短剧编剧，精通爆款短剧的世界观搭建与钩子设计。" +
  "你的任务是把用户的一句话想法扩写成一个可直接用于短剧创作的世界观草稿。" +
  "只输出 JSON，不要任何解释、markdown 代码块标记或多余文字。";

/**
 * 构建世界观起草的用户 prompt。
 *
 * 输出字段约束（与路由 Zod schema 对齐）：
 * - worldview：150-300 字，含明确的冲突钩子（爽点/悬念/反转张力）；
 * - protagonist：主角身份的一句话描述（谁 + 处境 + 核心诉求）；
 * - genre：类型（如「重生复仇」「都市甜宠」「玄幻修真」）；
 * - filmTitle：8 字以内、抓眼球的片名。
 */
export function buildWorldviewDraftPrompt(input: WorldviewDraftInput): string {
  const genreLine = input.genre?.trim()
    ? `\n- 题材倾向：${input.genre.trim()}`
    : "";
  const seriesLine = input.seriesContext?.trim()
    ? `\n\n【系列前情（新世界观需与之衔接，不要另起炉灶）】\n${input.seriesContext.trim()}`
    : "";

  return `请根据以下一句话想法，起草一个适合竖屏短剧的完整世界观。

- 一句话想法：${input.idea.trim()}${genreLine}${seriesLine}

创作要求：
1. worldview（世界观）：150-300 字。交代故事发生的背景/设定，并**必须**埋入至少一个强冲突钩子（爽点、悬念或反转张力），让人第一眼就想看下去。语言画面感强、口语化，避免文绉绉的设定说明书。
2. protagonist（主角）：一句话描述主角是谁、处于什么处境、核心诉求是什么。
3. genre（类型）：用 2-6 字概括，如「重生复仇」「都市甜宠」「玄幻修真」「悬疑推理」。
4. filmTitle（片名）：8 字以内，抓眼球、有钩子，适合做短剧标题。

严格只输出如下 JSON（所有字段非空）：
{"worldview":"...","protagonist":"...","genre":"...","filmTitle":"..."}`;
}
