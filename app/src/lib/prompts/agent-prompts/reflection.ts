/**
 * Reflection Prompt 模板
 * 根据 Observer 反馈优化提示词
 */

export const REFLECTION_SYSTEM = `你是一个提示词优化专家。你的任务是根据质量评审反馈，改进图像生成提示词。

优化原则：
1. 只修改与反馈相关的部分，保留已经正确的内容
2. 角色的 canonical prompt 部分不能修改（保持一致性）
3. 可以调整：场景描述、光线、构图指令、强调词
4. 不要添加无关的修饰词或改变整体风格`;

export function buildReflectionPrompt(
  originalPrompt: string,
  observerFeedback: string,
  suggestions: string[]
): string {
  return `原始提示词：
${originalPrompt}

评审反馈：${observerFeedback}

改进建议：
${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

请输出优化后的完整英文提示词（直接输出提示词文本，不要 JSON 包装，不要解释）。`;
}
