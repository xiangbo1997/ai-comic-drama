/**
 * CharacterBibleAgent Prompt 模板
 * 生成角色圣经，确保跨场景一致性
 */

export const CHARACTER_BIBLE_SYSTEM = `你是一个专业的角色设计师，擅长为漫剧创建详细的角色设定表。

你的核心任务：
1. 基于剧本中的角色描述，补全和丰富每个角色的外貌特征
2. 为每个角色生成标准化的英文图像生成提示词（canonical prompt）
3. 确保描述的一致性 — 同一角色在所有场景中必须使用相同的基础外貌

关键原则：
- canonical prompt 必须用英文，适合 Stable Diffusion / DALL-E 等模型
- 外貌特征要具体到可视化程度（不要模糊的"好看"之类的词）
- 如果原文没有明确描述某些特征，基于角色性格和故事背景合理推断
- 服装描述使用角色最常见的装扮`;

export function buildCharacterBiblePrompt(
  characters: Array<{ name: string; description: string }>,
  sceneContexts: Array<{
    id: number;
    characters: string[];
    description: string;
  }>
): string {
  const charList = characters
    .map((c) => `- ${c.name}: ${c.description}`)
    .join("\n");

  const sceneList = sceneContexts
    .slice(0, 10)
    .map(
      (s) =>
        `  场景${s.id}: ${s.characters.join("、")} — ${s.description.slice(0, 80)}`
    )
    .join("\n");

  return `基于以下剧本角色信息，生成完整的角色圣经。

角色列表：
${charList}

出场场景摘要：
${sceneList}

为每个角色输出以下 JSON 格式：
{
  "characters": [
    {
      "name": "角色名",
      "description": "中文完整描述",
      "canonicalPrompt": "1girl, 24yo, long black hair, oval face, large brown eyes, slender build, fair skin, white blouse, black pencil skirt, minimalist jewelry",
      "appearance": {
        "gender": "female",
        "age": "24",
        "hairStyle": "long straight hair",
        "hairColor": "black",
        "faceShape": "oval face",
        "eyeColor": "brown",
        "bodyType": "slender",
        "skinTone": "fair",
        "height": "165cm",
        "clothing": "white blouse with black pencil skirt",
        "accessories": "minimalist silver necklace"
      },
      "voiceProfile": {
        "gender": "female",
        "age": "young adult",
        "tone": "professional, slightly warm"
      },
      "appearances": [1, 3, 5, 8]
    }
  ]
}

要求：
1. canonicalPrompt 必须是英文，包含所有关键视觉特征
2. 使用 Stable Diffusion 友好的标签格式（逗号分隔）
3. appearance 中每个字段都必须填写
4. appearances 列出角色出现的所有场景 id
5. 输出纯 JSON`;
}
