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
5. quality (生成质量): 画面清晰度、细节丰富度

评分规则：
- 每项 0-100 分
- overall = 各项加权平均（scene_match 30%, character_consistency 30%, composition 15%, mood 15%, quality 10%）
- pass = overall >= 70
- 如果任一项 < 40，即使 overall >= 70 也不通过

你必须客观评判，不要"放水"。`;

export function buildImageReviewPrompt(
  sceneDescription: string,
  characterDescriptions: string,
  expectedEmotion: string,
  expectedShotType: string
): string {
  return `请评审以下 AI 生成的图像是否符合要求。

场景描述：${sceneDescription}

角色标准外貌：
${characterDescriptions}

期望情感：${expectedEmotion}
期望景别：${expectedShotType}

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
      "quality": 72
    },
    "pass": true,
    "feedback": "整体表现良好，但角色发色与设定略有偏差"
  },
  "retryable": true,
  "suggestions": [
    "角色发色应为黑色，当前偏深棕色",
    "背景光线偏暗，应增加环境光"
  ]
}

注意：如果无法看到图像（纯文本模式），基于提示词的完整性和准确性给出预评估。
输出纯 JSON`;
}
