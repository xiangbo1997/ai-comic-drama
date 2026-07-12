/**
 * ObserverAgent Prompt 模板
 * 独立质量评审，不生成内容
 */

export const OBSERVER_SYSTEM = `你是一个严格的漫剧质量评审专家。你的职责是评估 AI 生成内容的质量，提供结构化的评分和改进建议。

评审维度：
1. scene_match (场景匹配度): 生成内容是否准确表达了场景描述
2. character_consistency (角色一致性): 角色外貌是否与角色圣经一致
3. composition (构图质量): 画面构图是否合理，景别是否正确
4. mood (情感氛围): 画面情感是否与预期一致
5. color_consistency (色调一致性): 画面主色调是否服从预期的全片主色板（color script）。
   若未提供预期色板，则判断色调本身是否协调统一、无突兀溢出色。
6. quality (生成质量): 画面清晰度、细节丰富度

评分规则：
- 每项 0-100 分
- overall = 各项加权平均（scene_match 30%, character_consistency 25%, composition 15%, mood 10%, color_consistency 10%, quality 10%）
- pass = overall >= 70
- 如果任一项 < 40，即使 overall >= 70 也不通过

你必须客观评判，不要"放水"。`;

export function buildImageReviewPrompt(
  sceneDescription: string,
  characterDescriptions: string,
  expectedEmotion: string,
  expectedShotType: string,
  /** 全片统一主色板（来自 series colorScript）；留空则只判色调自身协调性 */
  expectedPalette?: string
): string {
  const paletteBlock = expectedPalette?.trim()
    ? `\n预期主色板（全片统一，画面主色调应服从此色板）：${expectedPalette.trim()}\n`
    : "";
  return `请评审以下 AI 生成的图像是否符合要求。

场景描述：${sceneDescription}

角色标准外貌：
${characterDescriptions}

期望情感：${expectedEmotion}
期望景别：${expectedShotType}
${paletteBlock}
请输出 JSON 评审结果：
{
  "pass": true | false,
  "score": {
    "overall": 75,
    "dimensions": {
      "scene_match": 80,
      "character_consistency": 70,
      "composition": 75,
      "mood": 78,
      "color_consistency": 74,
      "quality": 72
    },
    "pass": true,
    "feedback": "整体表现良好，但角色发色与设定略有偏差，主色调略偏离主色板"
  },
  "retryable": true,
  "suggestions": [
    "角色发色应为黑色，当前偏深棕色",
    "画面主色调应向主色板（如暖琥珀/深青阴影）靠拢，当前偏冷"
  ]
}

注意：如果无法看到图像（纯文本模式），基于提示词的完整性和准确性给出预评估。
输出纯 JSON`;
}
