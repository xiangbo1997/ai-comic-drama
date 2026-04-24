/**
 * StoryboardAgent Prompt 模板
 * 分镜补全：镜头语言、构图、时长
 */

export const STORYBOARD_SYSTEM = `你是一个资深的漫剧分镜导演，擅长将粗粒度的场景描述补全为可执行的分镜指令。

你的核心能力：
1. 根据叙事节奏选择最佳景别和机位
2. 为每个分镜生成详细的图像生成提示词
3. 安排合理的时长和转场效果
4. 确保角色描述与角色圣经完全一致`;

export function buildStoryboardPrompt(
  scenes: Array<{
    id: number;
    shotType: string;
    description: string;
    characters: string[];
    dialogue: string | null;
    narration: string | null;
    emotion: string;
    duration: number;
  }>,
  characterBible: Array<{
    name: string;
    canonicalPrompt: string;
    appearance: Record<string, string>;
  }>,
): string {
  const charRefMap = characterBible
    .map((c) => `- ${c.name}: ${c.canonicalPrompt}`)
    .join("\n");

  const sceneList = scenes
    .map(
      (s) =>
        `场景${s.id} [${s.shotType}] ${s.emotion}: ${s.description}` +
        (s.dialogue ? ` 对话: "${s.dialogue}"` : "") +
        (s.narration ? ` 旁白: "${s.narration}"` : ""),
    )
    .join("\n");

  return `基于以下场景和角色圣经，为每个分镜生成完整的图像生成提示词。

角色标准提示词（所有场景必须复用）：
${charRefMap}

原始分镜：
${sceneList}

为每个分镜输出 JSON：
{
  "scenes": [
    {
      "id": 1,
      "order": 1,
      "shotType": "中景",
      "description": "增强后的中文画面描述",
      "imagePrompt": "完整的英文图像生成提示词（包含角色canonical prompt + 场景 + 光线 + 构图 + 质量标签）",
      "characters": ["角色A"],
      "dialogue": "对话" | null,
      "narration": "旁白" | null,
      "emotion": "neutral",
      "duration": 3,
      "cameraMovement": "static" | "pan_left" | "zoom_in" | "tilt_up" | null,
      "transition": "cut" | "fade" | "dissolve" | null
    }
  ]
}

imagePrompt 构造规则：
1. 开头放画面风格（如 anime style）
2. 然后放角色的 canonicalPrompt（从上方角色标准提示词中复制，不要修改）
3. 接着放角色在此场景中的动作和表情
4. 然后放环境/背景描述
5. 添加景别英文（close-up, medium shot, wide shot 等）
6. 添加光线和氛围
7. 结尾放质量标签：masterpiece, best quality, highly detailed

输出纯 JSON`;
}
