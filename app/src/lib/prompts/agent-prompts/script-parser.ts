/**
 * ScriptParserAgent Prompt 模板
 * 多轮解析 + 自修复
 */

export const SCRIPT_PARSER_SYSTEM = `你是一个专业的漫剧分镜编剧，擅长将小说文本拆解为结构化的分镜脚本。

你的核心能力：
1. 精准识别故事节奏和情感转折点
2. 将叙事转化为视觉化的分镜描述
3. 提取并丰富角色外貌特征
4. 合理安排景别和镜头语言

输出要求（严格遵守）：
- 每个分镜包含：id、shotType、description、characters、dialogue、narration、emotion、duration
- shotType 必须为：特写、近景、中景、全景、远景 之一
- emotion 必须为：neutral、happy、sad、angry、surprised、fear 之一
- duration 为秒数，通常 2-5 秒
- description 必须足够详细，适合 AI 图像生成（包含环境、光线、人物动作/表情）
- characters 数组中的名字必须与顶层 characters 数组中的 name 完全一致

输出纯 JSON，不要 markdown 代码块，不要额外文字。`;

export function buildScriptParserUserPrompt(text: string): string {
  return `请将以下小说文本拆解为分镜脚本：

${text}

要求：
1. 提取所有出场角色及其详细外貌描述（发型、发色、脸型、眼睛、身材、肤色、服装等）
2. 将故事拆解为 10-30 个分镜
3. 每个分镜的 description 要包含：
   - 具体的环境/场景描述
   - 人物的动作和表情
   - 光线和氛围
   - 适合 AI 图像生成的视觉细节
4. 保留原文对话和旁白
5. 合理安排景别：对话用近景/中景，动作用全景，情感特写用特写

输出格式：
{
  "title": "作品标题",
  "scenes": [
    {
      "id": 1,
      "shotType": "中景",
      "description": "详细的画面描述...",
      "characters": ["角色A"],
      "dialogue": "对话内容" | null,
      "narration": "旁白内容" | null,
      "emotion": "neutral",
      "duration": 3
    }
  ],
  "characters": [
    {
      "name": "角色A",
      "description": "详细外貌描述：性别、年龄、发型发色、脸型、眼睛颜色、身材、肤色、典型服装"
    }
  ]
}`;
}

/** 自修复 prompt：将 Zod 验证错误反馈给 LLM */
export function buildScriptParserRepairPrompt(
  previousOutput: string,
  validationErrors: string
): string {
  return `你之前的输出有格式错误，请修正后重新输出完整 JSON。

你之前的输出（截取）：
${previousOutput.slice(0, 2000)}

验证错误：
${validationErrors}

请修正上述错误，输出完整的正确 JSON。保持内容不变，只修正格式问题。
输出纯 JSON，不要 markdown 代码块。`;
}
