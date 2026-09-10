/**
 * CharacterBibleAgent Prompt 模板
 * 生成角色圣经，确保跨场景一致性
 */

export const CHARACTER_BIBLE_SYSTEM = `你是一个专业的角色设计师，擅长为漫剧创建详细的角色设定表。

你的核心任务：
1. 基于剧本中的角色描述，补全和丰富每个角色的外貌特征
2. 为每个角色生成标准化的英文图像生成提示词（canonical prompt）
3. 确保描述的一致性 — 同一角色在所有场景中必须使用相同的基础外貌
4. 为每个角色定义「语言指纹」— 这决定观众能否遮掉角色名认出是谁在说话
5. 为每个角色定义「戏剧功能」— 欲望、障碍、行动，决定他凭什么留在这个故事里

关键原则：
- canonical prompt 必须用英文，适合 Stable Diffusion / DALL-E 等模型
- 外貌特征要具体到可视化程度（不要模糊的"好看"之类的词）
- 如果原文没有明确描述某些特征，基于角色性格和故事背景合理推断
- 服装描述使用角色最常见的装扮
- 反派的 want 必须【自身逻辑成立】：他要的东西在他的立场上合理，只是与主角不可调和。
  严禁「因为他是反派所以他要害人」这类动机
- 每个配角必须有明确的 role。若一个角色找不到功能定位，说明他不该存在 —
  在 description 里标注「建议合并或删除」`;

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
      "speechFingerprint": {
        "register": "留洋归国，用词偏书面，偶尔夹一个英文单词",
        "sentenceStyle": "长句反问为主，被冒犯时反而放慢语速",
        "verbalTic": "「有意思」",
        "taboo": "绝不说脏字，也绝不主动示弱"
      },
      "dramaticFunction": {
        "role": "主角",
        "want": "拿回被继母侵吞的母亲遗产股权",
        "obstacle": "继母掌握董事会多数席位，且握有她父亲的把柄",
        "action": "以设计师身份重回公司，逐个瓦解继母的盟友",
        "flaw": "对示弱的人心软，屡次因此错失时机"
      },
      "appearances": [1, 3, 5, 8]
    }
  ]
}

字段说明：
- speechFingerprint（语言指纹，决定对白差异化）：
  · register：文化程度与语域，如「小学文化，市井口语，爱用歇后语」「留洋归国，句式偏书面」
  · sentenceStyle：句式特征，如「短句为主，常以停顿代替反驳」「长句反问，攻击性强」
  · verbalTic：一到两个高辨识度口头禅或语气词，如「行吧」「我告诉你」；无则留空字符串
  · taboo：这个角色绝不会说的话或词，如「绝不服软认错」「不说脏字」
- dramaticFunction（戏剧功能，决定角色凭什么存在）：
  · role：必须是「主角 / 帮手 / 阻碍 / 信息源 / 镜像」五选一
  · want：他要什么 — 必须具体、可视、可被夺走。禁止「想要幸福」这类抽象表述
  · obstacle：谁或什么挡着他 — 必须与 want 等强，弱障碍撑不起冲突
  · action：他会为此采取什么行动 — 决定这个角色在每一集的戏份
  · flaw：致命弱点或认知盲区 — 反转与打脸的支点

要求：
1. canonicalPrompt 必须是英文，包含所有关键视觉特征
2. 使用 Stable Diffusion 友好的标签格式（逗号分隔）
3. appearance 中每个字段都必须填写
4. speechFingerprint 与 dramaticFunction 每个角色都要填 —
   检验标准：遮掉角色名，读者应能从用词和句式判断出是谁在说话
5. appearances 列出角色出现的所有场景 id
6. 输出纯 JSON`;
}
