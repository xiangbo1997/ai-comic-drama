/**
 * StoryboardAgent Prompt 模板
 * 分镜补全：镜头语言、构图、时长
 */

import { PROMPT_FIDELITY_RULES } from "../prompt-fidelity";

export const STORYBOARD_SYSTEM = `你是一个资深的漫剧分镜导演，擅长将粗粒度的场景描述补全为可执行的分镜指令。

你的核心能力：
1. 根据叙事节奏选择最佳景别和机位
2. 为每个分镜生成详细的图像生成提示词
3. 安排合理的时长和转场效果
4. 确保角色描述与角色圣经完全一致

${PROMPT_FIDELITY_RULES}`;

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
    // 解析层已产出的镜头语言四字段（必须原样复用进 imagePrompt，勿改写）
    cameraAngle?: string;
    lighting?: string;
    composition?: string;
    colorPalette?: string;
  }>,
  characterBible: Array<{
    name: string;
    canonicalPrompt: string;
    appearance: Record<string, string>;
  }>
): string {
  const charRefMap = characterBible
    .map((c) => `- ${c.name}: ${c.canonicalPrompt}`)
    .join("\n");

  const sceneList = scenes
    .map((s) => {
      // 镜头语言四字段拼成一行提示，供 LLM 原样复用进 imagePrompt（自动路径与手动对齐）
      const cine = [
        s.cameraAngle ? `机位:${s.cameraAngle}` : "",
        s.lighting ? `光线:${s.lighting}` : "",
        s.composition ? `构图:${s.composition}` : "",
        s.colorPalette ? `色调:${s.colorPalette}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      return (
        `场景${s.id} [${s.shotType}] ${s.emotion}: ${s.description}` +
        (s.dialogue ? ` 对话: "${s.dialogue}"` : "") +
        (s.narration ? ` 旁白: "${s.narration}"` : "") +
        (cine ? ` 镜头语言: ${cine}` : "")
      );
    })
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
      "imagePrompt": "完整的英文图像生成提示词（顺序：风格 → 镜头语言(景别/机位/构图) → 角色canonical prompt → 动作+夸张表情 → 环境 → 光线/色彩 → 质量标签）",
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

imagePrompt 构造规则（顺序即权重，高权重在前，与手动出图路径对齐）：
1. 开头放画面风格（如 anime style）
2. 镜头语言：把上方「镜头语言」标注的机位/光线/构图/色调【必须原样复用】翻译成英文前置（如 low-angle shot, rule of thirds），不得省略或改写
3. 然后放角色的 canonicalPrompt（从上方角色标准提示词中复制，不要修改）
4. 接着放角色在此场景中的动作和【夸张表情】——情绪要画出来（如 furious gritted teeth）而非只标注 mood
5. 然后放环境/背景描述
6. 光线与色彩（复用上方标注）
7. 结尾放质量标签：masterpiece, best quality, highly detailed

输出纯 JSON`;
}
