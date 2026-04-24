/**
 * 策略选择器
 * 根据 Provider 能力、角色数量、景别选择最优生成策略
 */

import { getImageProviderCapability } from "@/services/ai/provider-factory";
import type { AIServiceConfig } from "@/types";
import type {
  SceneCharacterInfo,
  StrategyDecision,
  GenerationStrategy,
} from "./types";

export interface ResolveStrategyOptions {
  /** 客户端/上游显式传入的参考图；若提供，覆盖主角色 canonicalImage 推断 */
  referenceImagesOverride?: string[];
}

export function resolveStrategy(
  characters: SceneCharacterInfo[],
  prompt: string,
  imageConfig: AIServiceConfig,
  shotType?: string,
  options?: ResolveStrategyOptions
): StrategyDecision {
  const capability = getImageProviderCapability(imageConfig.protocol);

  const primaryCharacter = characters.find((c) => c.role === "primary");
  const canonicalImage = primaryCharacter?.canonicalImageUrl;

  // 多图合并：显式 override 优先；否则收集所有角色的 canonicalImageUrl（按 role 顺序：primary first）
  const collectedUrls: string[] = [];
  if (
    options?.referenceImagesOverride &&
    options.referenceImagesOverride.length > 0
  ) {
    collectedUrls.push(...options.referenceImagesOverride);
  } else {
    const ordered = [...characters].sort(
      (a, b) => roleWeight(a.role) - roleWeight(b.role)
    );
    for (const c of ordered) {
      if (c.canonicalImageUrl) collectedUrls.push(c.canonicalImageUrl);
    }
  }

  // 能力裁剪：若 provider 不支持多图，截到 maxReferenceImages
  const maxRefs = capability.supportsMultipleReferences
    ? capability.maxReferenceImages
    : 1;
  const referenceImageUrls = collectedUrls.slice(0, Math.max(0, maxRefs));

  let strategy: GenerationStrategy = "prompt_only";
  let referenceImageUrl: string | undefined;

  if (referenceImageUrls.length > 0 && capability.supportsReferenceImage) {
    strategy = "reference_edit";
    // 兼容：单图场景仍然设置第一张为 referenceImageUrl
    referenceImageUrl = referenceImageUrls[0] ?? canonicalImage;
  }

  const enhancedPrompt = buildStrategyPrompt(
    prompt,
    characters,
    strategy,
    shotType
  );

  return {
    strategy,
    primaryCharacter,
    referenceImageUrl,
    referenceImageUrls:
      referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    enhancedPrompt,
    capability,
  };
}

function roleWeight(role: SceneCharacterInfo["role"]): number {
  return role === "primary" ? 0 : role === "secondary" ? 1 : 2;
}

function buildStrategyPrompt(
  basePrompt: string,
  characters: SceneCharacterInfo[],
  strategy: GenerationStrategy,
  shotType?: string
): string {
  const parts: string[] = [];

  // 角色外貌描述（结构化优先，fallback 到 description）
  for (const char of characters) {
    const features = buildCharacterFeatures(char);
    if (features) {
      const roleLabel = char.role === "primary" ? "(main character)" : "";
      parts.push(`${char.name}${roleLabel}: ${features}`);
    }
  }

  parts.push(basePrompt);

  if (shotType) {
    parts.push(`shot type: ${shotType}`);
  }

  if (strategy === "reference_edit") {
    parts.push(
      "IMPORTANT: Keep character appearance exactly as described above, consistent facial features, consistent hairstyle, consistent clothing"
    );
  }

  parts.push("masterpiece, best quality, highly detailed");

  return parts.filter(Boolean).join(", ");
}

function buildCharacterFeatures(char: SceneCharacterInfo): string {
  const appearance = char.appearance;

  if (appearance) {
    const fields = [
      char.gender === "male"
        ? "male"
        : char.gender === "female"
          ? "female"
          : null,
      char.age ? `${char.age} years old` : null,
      appearance.hairColor && appearance.hairStyle
        ? `${appearance.hairColor} ${appearance.hairStyle}`
        : appearance.hairStyle || appearance.hairColor || null,
      appearance.faceShape,
      appearance.eyeColor ? `${appearance.eyeColor} eyes` : null,
      appearance.bodyType,
      appearance.skinTone ? `${appearance.skinTone} skin` : null,
      appearance.height,
      appearance.accessories,
      appearance.freeText,
    ];
    return fields.filter(Boolean).join(", ");
  }

  // fallback 到旧的 description 字段
  const fallback = [
    char.gender === "male"
      ? "male"
      : char.gender === "female"
        ? "female"
        : null,
    char.age ? `${char.age} years old` : null,
    char.description,
  ];
  return fallback.filter(Boolean).join(", ");
}
