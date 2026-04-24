/**
 * Prompt 构建工具
 * 用于构建增强的图像生成 prompt，支持角色固定特征和场景分析
 */

import type {
  CharacterInfo,
  AnalyzeSceneRequest,
  CharacterAction,
  SceneAnalysis,
} from "@/types";

export type {
  CharacterInfo,
  AnalyzeSceneRequest,
  CharacterAction,
  SceneAnalysis,
};

// 风格和景别函数已迁移到 lib/prompts/image-prompt.ts，这里重导出保持兼容
import { getStylePrefix, getShotTypeDescription } from "@/lib/prompts";
import {
  getNegativePromptPreset,
  type NegativePromptPreset,
} from "@/lib/prompts/negative-prompts";

import { createLogger } from "@/lib/logger";
const log = createLogger("lib:prompt-builder");
export { getStylePrefix, getShotTypeDescription };
export { getNegativePromptPreset };
export type { NegativePromptPreset };

// ============ Prompt 构建 ============

export interface BuildPromptOptions {
  style?: string;
  characters: CharacterInfo[];
  analysis: SceneAnalysis;
  shotType?: string;
  originalPrompt?: string;
}

/**
 * 构建增强的图像生成 prompt
 *
 * 策略：
 * - 角色 description 包含完整的人物形象描述（外貌+服装+发型+饰品）
 * - 将 description 放在 prompt 前面，强调这是角色的固定特征
 * - 动作、表情、姿态根据场景变化
 *
 * @param options 构建选项
 * @returns 增强后的 prompt
 */
export function buildEnhancedPrompt(options: BuildPromptOptions): string {
  const { style, characters, analysis, shotType, originalPrompt } = options;

  const parts: string[] = [];

  // 1. 风格前缀
  parts.push(getStylePrefix(style));

  // 2. 角色外貌描述（重要：放在最前面，作为固定特征）
  if (characters.length > 0) {
    const characterDescriptions = characters.map((c) => {
      // 组合角色的所有固定特征：性别 + 年龄 + 描述
      const features = [
        c.gender === "male" ? "male" : c.gender === "female" ? "female" : null,
        c.age ? `${c.age} years old` : null,
        c.description || null, // 完整的外貌描述
      ].filter(Boolean);

      return `${c.name}: ${features.join(", ")}`;
    });

    if (characterDescriptions.length === 1) {
      parts.push(`character: ${characterDescriptions[0]}`);
    } else {
      parts.push(`characters: ${characterDescriptions.join("; ")}`);
    }
  }

  // 3. 角色动作和表情（从分析结果）
  if (analysis.characterActions.length > 0) {
    const actionDescriptions = analysis.characterActions.map((ca) => {
      const actionParts = [ca.action, ca.expression].filter(Boolean);
      if (ca.position) {
        actionParts.push(ca.position);
      }
      return `${ca.characterName}: ${actionParts.join(", ")}`;
    });
    parts.push(actionDescriptions.join("; "));
  }

  // 4. 角色互动
  if (analysis.interaction) {
    parts.push(analysis.interaction);
  }

  // 5. 环境描述
  if (analysis.environment) {
    parts.push(analysis.environment);
  }

  // 6. 光线
  if (analysis.lighting) {
    parts.push(analysis.lighting);
  }

  // 7. 景别
  parts.push(getShotTypeDescription(shotType));

  // 8. 氛围
  if (analysis.mood) {
    parts.push(`${analysis.mood} atmosphere`);
  }

  // 9. 镜头角度
  if (analysis.cameraAngle) {
    parts.push(analysis.cameraAngle);
  }

  // 10. 原始提示词（如果有自定义内容）
  if (originalPrompt) {
    parts.push(originalPrompt);
  }

  // 11. 质量标签 + 保持角色一致性的强化提示
  parts.push(
    "IMPORTANT: Keep character appearance exactly as described above, consistent facial features, consistent hairstyle, consistent clothing"
  );
  parts.push("masterpiece, best quality, highly detailed");

  return parts.filter(Boolean).join(", ");
}

// ============ 客户端侧的简洁 Prompt 构建 ============

/**
 * 客户端（编辑器）侧的薄包装：生成"核心描述 prompt"。
 *
 * 设计考量：
 * - 服务端 `/api/generate/image` 会调用 `buildSceneAnalysisPrompt` + `buildEnhancedPrompt`
 *   做完整的角色/环境/光线注入（依赖 DB 中的角色 referenceImages/appearance）。
 * - 客户端不应再重复做角色注入——只负责组合场景语义（风格、核心描述、景别、情绪）。
 * - 客户端要负责把 `referenceImage` 和 `negativePrompt` 传给服务端，这是激活一致性
 *   路径（reference_edit 策略）与画质基线的关键。
 *
 * @returns `{ prompt, negativePrompt, referenceImage? }` —— 分别放进 API 请求体。
 */
export interface BuildFinalPromptInput {
  /** 项目风格（anime / realistic / comic 等） */
  style?: string | null;
  /** 场景核心描述 */
  sceneDescription: string;
  /** 景别（中景/近景/特写 等） */
  shotType?: string | null;
  /** 情绪（neutral/happy/sad 等） */
  emotion?: string | null;
  /** 角色的首张参考图（定妆图）URL —— 激活 orchestrator 的 reference_edit 策略 */
  referenceImageUrl?: string | null;
  /** 自定义 negative prompt（追加到风格预设之后） */
  customNegative?: string;
  /** 是否保留服务端分析（默认 true；即使是 false，服务端当前仍会分析） */
  preserveServerAnalysis?: boolean;
}

export interface BuildFinalPromptOutput {
  prompt: string;
  negativePrompt: string;
  referenceImage?: string;
}

export function buildFinalPrompt(
  input: BuildFinalPromptInput
): BuildFinalPromptOutput {
  const {
    style,
    sceneDescription,
    shotType,
    emotion,
    referenceImageUrl,
    customNegative,
  } = input;

  const parts: string[] = [];
  parts.push(getStylePrefix(style ?? undefined));
  if (sceneDescription?.trim()) parts.push(sceneDescription.trim());
  if (shotType) parts.push(getShotTypeDescription(shotType));
  if (emotion) parts.push(`${emotion} mood`);
  // 质量基线放末尾，避免主体描述被削弱
  parts.push("masterpiece, best quality, highly detailed");

  const prompt = parts.filter(Boolean).join(", ");

  const baseNegative = getNegativePromptPreset(style ?? undefined);
  const negativePrompt = [baseNegative, customNegative]
    .filter(Boolean)
    .map((s) => s!.trim())
    .join(", ");

  return {
    prompt,
    negativePrompt,
    referenceImage: referenceImageUrl ?? undefined,
  };
}

// ============ 场景分析 Prompt 模板 ============

/**
 * 生成场景分析的 LLM prompt
 * @param request 分析请求
 * @returns LLM prompt
 */
export function buildSceneAnalysisPrompt(request: AnalyzeSceneRequest): string {
  const { sceneDescription, dialogue, characters, emotion, shotType } = request;

  const characterInfo = characters
    .map((c) => {
      const details = [c.gender, c.age].filter(Boolean).join(", ");
      return `- ${c.name}${details ? ` (${details})` : ""}`;
    })
    .join("\n");

  return `你是一个专业的分镜师，请分析以下场景，提取图片生成所需的关键信息。

## 场景描述
${sceneDescription}

${dialogue ? `## 对话内容\n${dialogue}\n` : ""}
## 角色信息
${characterInfo || "（无指定角色）"}

${emotion ? `## 情感基调\n${emotion}\n` : ""}
${shotType ? `## 景别\n${shotType}\n` : ""}

请分析并输出 JSON 格式的结果：

\`\`\`json
{
  "characterActions": [
    {
      "characterName": "角色名",
      "action": "具体动作描述，如：站在窗边，双手抱胸",
      "expression": "表情描述，如：若有所思的表情",
      "position": "位置描述，如：画面左侧"
    }
  ],
  "interaction": "角色之间的互动方式（如果有多个角色）",
  "environment": "场景环境细节描述",
  "lighting": "光线描述",
  "mood": "整体氛围，如：紧张、温馨、浪漫",
  "cameraAngle": "推荐的镜头角度"
}
\`\`\`

注意：
1. 动作要具体，如"站在窗边，双手抱胸"而不是"站着"
2. 表情要根据对话内容和情感推断
3. 如果有多个角色，描述他们的相对位置和互动
4. 只输出 JSON，不要有其他内容`;
}

/**
 * 解析场景分析结果
 * @param response LLM 响应
 * @returns 解析后的场景分析结果
 */
export function parseSceneAnalysisResponse(response: string): SceneAnalysis {
  // 尝试提取 JSON
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : response;

  try {
    const parsed = JSON.parse(jsonStr.trim());

    // 验证并规范化结果
    return {
      characterActions: Array.isArray(parsed.characterActions)
        ? parsed.characterActions.map((ca: CharacterAction) => ({
            characterName: ca.characterName || "",
            action: ca.action || "",
            expression: ca.expression || "",
            position: ca.position,
          }))
        : [],
      interaction: parsed.interaction || undefined,
      environment: parsed.environment || "indoor scene",
      lighting: parsed.lighting || undefined,
      mood: parsed.mood || "neutral",
      cameraAngle: parsed.cameraAngle || undefined,
    };
  } catch {
    // 解析失败，返回默认值
    log.error("Failed to parse scene analysis response:", response);
    return {
      characterActions: [],
      environment: "scene",
      mood: "neutral",
    };
  }
}
