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
import {
  getStylePrefix,
  getShotTypeDescription,
  getLightingPrefix,
  buildConsistencyGuard,
  getStylePack,
} from "@/lib/prompts";
import {
  buildEmotionPhrase,
  inferEmotionIntensity,
  type EmotionIntensity,
} from "@/lib/prompts/emotion-grammar";
import {
  getNegativePromptPreset,
  getSceneNegativePrompt,
  type NegativePromptPreset,
} from "@/lib/prompts/negative-prompts";

import { createLogger } from "@/lib/logger";
const log = createLogger("lib:prompt-builder");
export { getStylePrefix, getShotTypeDescription };
export { getNegativePromptPreset };
export type { NegativePromptPreset };

// ============ Prompt 构建 ============

/**
 * 出图 prompt 的质量词风格：
 * - "tags"：booru 风格逗号标签（masterpiece, best quality...），SD 系模型（replicate/fal/siliconflow）吃这套。
 * - "natural"：自然语言（high quality, highly detailed image），指令类模型（openai/gemini/claude）吃这套。
 */
export type PromptQualityStyle = "tags" | "natural";

/** SD 系协议（吃 booru 标签）；其余指令类模型走自然语言。 */
const SD_FAMILY_PROTOCOLS: ReadonlySet<string> = new Set([
  "replicate",
  "fal",
  "siliconflow",
]);

/**
 * 由 provider 协议推断质量词风格。未知/指令类回落 "natural"（安全默认——
 * 自然语言不会在 SD 上崩，反之 booru 标签喂给指令模型会被当普通文本淡化）。
 */
export function promptStyleFromProtocol(
  protocol?: string | null
): PromptQualityStyle {
  const p = protocol?.trim().toLowerCase();
  return p && SD_FAMILY_PROTOCOLS.has(p) ? "tags" : "natural";
}

/** 分级镜头语言：解析层产出的 cameraAngle/lighting/composition/colorPalette。 */
export interface SceneCinematics {
  cameraAngle?: string | null;
  lighting?: string | null;
  composition?: string | null;
  colorPalette?: string | null;
}

export interface BuildPromptOptions {
  style?: string;
  characters: CharacterInfo[];
  analysis: SceneAnalysis;
  shotType?: string;
  originalPrompt?: string;
  /**
   * 系列级统一主色板（color script）的英文约束文本。
   * 调用方可从 series 的 colorScript 传入（如把 keyColors + overallTone 拼成
   * "warm amber, deep teal shadow; overall tone: desaturated teal-and-orange"），
   * 使整部剧色调统一。留空则行为完全不变（向后兼容）。
   */
  seriesPalette?: string;
  /**
   * 镜头语言（解析层产出）。前置注入到 style 之后、角色之前（高权重位），
   * 替代此前在 route 末尾 tail-append 的低权重做法。留空则不注入。
   */
  cinematics?: SceneCinematics;
  /** 情绪（neutral/happy/sad/angry/surprised/fear）；驱动夸张表情语法。 */
  emotion?: string | null;
  /** 情绪强度（low/medium/climax）；缺省时按 emotion+景别+isClimax 推断。 */
  emotionIntensity?: EmotionIntensity;
  /** 高潮镜头标记；true 时情绪强度直接拉到 climax。 */
  isClimax?: boolean;
  /** 画幅（9:16 时注入竖屏构图基线）。 */
  aspectRatio?: string | null;
  /** 质量词风格（SD 系用 tags，指令类用 natural）。缺省 natural（安全默认）。 */
  promptStyle?: PromptQualityStyle;
  /**
   * 用旧的段落排序（质量词在前、镜头语言 tail-append）。默认 false = 新排序。
   * 仅作廉价回滚开关，不做 A/B 基建。
   */
  legacyOrdering?: boolean;
}

/**
 * 构建增强的图像生成 prompt（漫剧化重排）
 *
 * 新排序（默认，权重从高到低）：
 *   风格锚定 → 镜头语言（景别/机位/构图，前置高权重） → 角色 →
 *   动作 + 夸张表情（消费情绪语法） → 环境 → 光线/色彩 → 质量词 + 一致性护栏
 * 相比旧排序，把镜头语言从末尾 tail-append 提到角色之前，把夸张表情/漫画符号
 * 注入动作段——让高潮镜头被真正画出漫剧感，而非渲染成平静插画。
 *
 * legacyOrdering=true 时回退旧排序（质量词在前、镜头语言 tail-append），廉价回滚。
 *
 * @param options 构建选项（cinematics/emotion/aspectRatio/promptStyle 均可选）
 * @returns 增强后的 prompt
 */
export function buildEnhancedPrompt(options: BuildPromptOptions): string {
  if (options.legacyOrdering) {
    return buildEnhancedPromptLegacy(options);
  }

  const {
    style,
    characters,
    analysis,
    shotType,
    originalPrompt,
    seriesPalette,
    cinematics,
    emotion,
    emotionIntensity,
    isClimax,
    aspectRatio,
    promptStyle = "natural",
  } = options;

  const parts: string[] = [];
  const pack = getStylePack(style);

  // 1. 风格锚定
  parts.push(pack.anchor);

  // 2. 镜头语言（前置高权重）：景别 → 机位/角度 → 构图。
  //    优先解析层的 cinematics.composition/cameraAngle；景别过 SHOT_MAP 翻译成焦段+景深。
  parts.push(getShotTypeDescription(shotType));
  const cameraAngle = cinematics?.cameraAngle?.trim();
  if (cameraAngle) parts.push(cameraAngle);
  const composition = cinematics?.composition?.trim();
  if (composition) parts.push(composition);
  // 9:16 竖屏构图基线（漫剧默认竖屏，需主体上移+纵深强调）
  if (aspectRatio === "9:16") {
    parts.push(
      "vertical composition, subject in upper two-thirds, strong vertical depth"
    );
  }

  // 3. 角色外貌描述（固定特征）
  if (characters.length > 0) {
    const characterDescriptions = characters.map((c) => {
      const features = [
        c.gender === "male" ? "male" : c.gender === "female" ? "female" : null,
        c.age ? `${c.age} years old` : null,
        c.description || null,
      ].filter(Boolean);
      return `${c.name}: ${features.join(", ")}`;
    });
    if (characterDescriptions.length === 1) {
      parts.push(`character: ${characterDescriptions[0]}`);
    } else {
      parts.push(`characters: ${characterDescriptions.join("; ")}`);
    }
  }

  // 4. 角色动作 + 夸张表情（情绪语法）。动作来自分析；表情/符号来自 emotion-grammar，
  //    按 emotion×强度×画风生成，写实画风自动无漫画符号。
  if (analysis.characterActions.length > 0) {
    const actionDescriptions = analysis.characterActions.map((ca) => {
      const actionParts = [ca.action, ca.expression].filter(Boolean);
      if (ca.position) actionParts.push(ca.position);
      return `${ca.characterName}: ${actionParts.join(", ")}`;
    });
    parts.push(actionDescriptions.join("; "));
  }
  if (analysis.interaction) parts.push(analysis.interaction);

  const intensity =
    emotionIntensity ?? inferEmotionIntensity(emotion, shotType, isClimax);
  const emotionPhrase = buildEmotionPhrase(emotion, intensity, style);
  if (emotionPhrase) parts.push(emotionPhrase);

  // 5. 环境描述（+ 画风包场景规则英文精炼版；legacy 平面风格为空自动跳过）
  if (analysis.environment) {
    parts.push(analysis.environment);
    if (pack.sceneRulesEn.trim()) parts.push(pack.sceneRulesEn);
  }

  // 6. 光线 + 色彩：光线过预设映射；色彩优先系列主色板 → cinematics.colorPalette →
  //    画风包英文色彩基线（legacy 为空自动跳过）。
  const lighting = getLightingPrefix(cinematics?.lighting ?? analysis.lighting);
  if (lighting) parts.push(lighting);

  const palette = seriesPalette?.trim();
  if (palette) {
    parts.push(`unified color palette (obey across all shots): ${palette}`);
  } else {
    const colorPalette = cinematics?.colorPalette?.trim();
    if (colorPalette) parts.push(colorPalette);
    if (pack.colorSystemEn.trim()) parts.push(pack.colorSystemEn);
  }

  // 7. 氛围
  if (analysis.mood) parts.push(`${analysis.mood} atmosphere`);

  // 8. 原始提示词（自定义内容）
  if (originalPrompt) parts.push(originalPrompt);

  // 9. 一致性护栏 + 质量词（按协议分风格：SD 系用 booru 标签，指令类用自然语言）
  parts.push(buildConsistencyGuard(characters.length));
  parts.push(qualityWords(promptStyle));

  return parts.filter(Boolean).join(", ");
}

/** 质量词：SD 系 booru 标签 vs 指令类自然语言。 */
function qualityWords(style: PromptQualityStyle): string {
  return style === "tags"
    ? "masterpiece, best quality, highly detailed"
    : "high quality, highly detailed, cinematic";
}

/**
 * 旧排序实现（legacyOrdering=true 回滚用）：质量词在前、镜头语言 tail-append。
 * 保留原行为逐字不改，作为廉价回退路径。
 */
function buildEnhancedPromptLegacy(options: BuildPromptOptions): string {
  const {
    style,
    characters,
    analysis,
    shotType,
    originalPrompt,
    seriesPalette,
  } = options;

  const parts: string[] = [];
  const pack = getStylePack(style);

  parts.push(pack.anchor);

  const palette = seriesPalette?.trim();
  if (palette) {
    parts.push(
      `unified color palette (must obey across all shots): ${palette}`
    );
  } else if (pack.colorSystem.trim()) {
    parts.push(`色彩风格基线（画面色调服从画风调性）：${pack.colorSystem}`);
  }

  if (characters.length > 0) {
    const characterDescriptions = characters.map((c) => {
      const features = [
        c.gender === "male" ? "male" : c.gender === "female" ? "female" : null,
        c.age ? `${c.age} years old` : null,
        c.description || null,
      ].filter(Boolean);
      return `${c.name}: ${features.join(", ")}`;
    });
    if (characterDescriptions.length === 1) {
      parts.push(`character: ${characterDescriptions[0]}`);
    } else {
      parts.push(`characters: ${characterDescriptions.join("; ")}`);
    }
  }

  if (analysis.characterActions.length > 0) {
    const actionDescriptions = analysis.characterActions.map((ca) => {
      const actionParts = [ca.action, ca.expression].filter(Boolean);
      if (ca.position) actionParts.push(ca.position);
      return `${ca.characterName}: ${actionParts.join(", ")}`;
    });
    parts.push(actionDescriptions.join("; "));
  }

  if (analysis.interaction) parts.push(analysis.interaction);

  if (analysis.environment) {
    parts.push(analysis.environment);
    if (pack.sceneRules.trim()) parts.push(`场景画风：${pack.sceneRules}`);
  }

  const lighting = getLightingPrefix(analysis.lighting);
  if (lighting) parts.push(lighting);

  parts.push(getShotTypeDescription(shotType));

  if (analysis.mood) parts.push(`${analysis.mood} atmosphere`);
  if (analysis.cameraAngle) parts.push(analysis.cameraAngle);
  if (originalPrompt) parts.push(originalPrompt);

  parts.push(buildConsistencyGuard(characters.length));
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
  /** 多角色参考图列表（每个角色的定妆图 URL）；优先于 referenceImageUrl */
  referenceImageUrls?: string[];
  /** 自定义 negative prompt（追加到风格预设之后） */
  customNegative?: string;
  /** 是否保留服务端分析（默认 true；即使是 false，服务端当前仍会分析） */
  preserveServerAnalysis?: boolean;
}

export interface BuildFinalPromptOutput {
  prompt: string;
  negativePrompt: string;
  referenceImage?: string;
  /** 多参考图列表；客户端把它一并传给服务端激活多图一致性 */
  referenceImages?: string[];
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
    referenceImageUrls,
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

  // 合并多图与单图：数组优先；否则把单张包成数组用于服务端
  const mergedRefs =
    referenceImageUrls && referenceImageUrls.length > 0
      ? referenceImageUrls
      : referenceImageUrl
        ? [referenceImageUrl]
        : undefined;

  // 角色数从参考图数量推断：多角色场景自动叠加"不克隆脸/保持人数"负向护栏，
  // 与服务端 buildEnhancedPrompt 的正向一致性护栏首尾呼应。
  const characterCount = mergedRefs?.length ?? 0;
  const baseNegative = getSceneNegativePrompt(
    style ?? undefined,
    characterCount
  );
  const negativePrompt = [baseNegative, customNegative]
    .filter(Boolean)
    .map((s) => s!.trim())
    .join(", ");

  return {
    prompt,
    negativePrompt,
    referenceImage: mergedRefs?.[0],
    referenceImages: mergedRefs,
  };
}

// ============ 场景分析 Prompt 模板 ============

/**
 * 生成场景分析的 LLM prompt
 * @param request 分析请求
 * @returns LLM prompt
 */
export function buildSceneAnalysisPrompt(request: AnalyzeSceneRequest): string {
  const {
    sceneDescription,
    dialogue,
    characters,
    emotion,
    shotType,
    prevSceneDescription,
    nextSceneDescription,
    continuityLighting,
    seriesContext,
  } = request;

  const characterInfo = characters
    .map((c) => {
      const details = [c.gender, c.age].filter(Boolean).join(", ");
      return `- ${c.name}${details ? ` (${details})` : ""}`;
    })
    .join("\n");

  // 连续性上下文（承接前情/铺垫后续）：有相邻镜时注入，让人物状态/道具/服装延续。
  // 同地点时额外强制承接光线基调（continuityLighting），防止昼夜/冷暖漂移。
  const continuityBlock =
    prevSceneDescription || nextSceneDescription || continuityLighting
      ? `## 连续性上下文（承接前后镜，人物状态/道具/服装要延续，不与前情冲突）
${prevSceneDescription ? `上一镜：${prevSceneDescription}\n` : ""}${nextSceneDescription ? `下一镜：${nextSceneDescription}\n` : ""}${continuityLighting ? `同地点光线基调（本镜光线必须承接，不得昼夜/冷暖漂移）：${continuityLighting}\n` : ""}`
      : "";

  // 系列记忆（既定场景/道具/角色状态）：续集时注入，保证跨集视觉一致
  const seriesBlock = seriesContext?.trim()
    ? `## 系列既定设定（沿用，勿与之冲突）\n${seriesContext.trim()}\n`
    : "";

  return `你是一个专业的分镜师，请分析以下场景，提取图片生成所需的关键信息。

## 场景描述
${sceneDescription}

${dialogue ? `## 对话内容\n${dialogue}\n` : ""}
## 角色信息
${characterInfo || "（无指定角色）"}

${emotion ? `## 情感基调\n${emotion}\n` : ""}
${shotType ? `## 景别\n${shotType}\n` : ""}
${continuityBlock}
${seriesBlock}
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
4. 人物状态/道具/服装延续前情，不与前后镜冲突（若提供了连续性上下文）
5. 只输出 JSON，不要有其他内容`;
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
