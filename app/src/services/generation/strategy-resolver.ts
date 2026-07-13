/**
 * 策略选择器
 * 根据 Provider 能力、角色数量、景别选择最优生成策略
 */

import { getImageProviderCapability } from "@/services/ai/provider-factory";
import { pickAssetUrlForFacing, type Facing } from "./facing";
import type { AIServiceConfig } from "@/types";
import type {
  SceneCharacterInfo,
  StrategyDecision,
  GenerationStrategy,
} from "./types";

export interface ResolveStrategyOptions {
  /** 客户端/上游显式传入的参考图；若提供，覆盖主角色 canonicalImage 推断 */
  referenceImagesOverride?: string[];
  /**
   * 迭代模式：参考图是「上一版整图」而非角色定妆脸。
   * 为 true 时 reference_edit 措辞改为「以整图为基础、保留构图与身份、按需改动」，
   * 避免默认「锁死角色外貌」与用户「改外貌类指令」冲突。
   */
  iterateMode?: boolean;
  /**
   * 分镜里角色的朝向（front|side|back）。收集每角色参考图时，把该角色
   * referenceAssets 里朝向匹配的资产 URL 排到其首位（其余顺序不变）；
   * 无 referenceAssets 时行为与现状完全一致（零回归）。
   */
  facing?: Facing;
  /**
   * 换装定妆照覆盖（场景定妆照）：characterId → 换装定妆照 URL。
   * 命中的角色收集参考图时，把换装图置于该角色 URL 列表首位（服装正确性优先于视角）；
   * 其余参考图保留在后。无 override 的角色行为与现状完全一致（零回归）。
   * 仅在 referenceImagesOverride 缺省（走逐角色收集分支）时生效。
   */
  lookOverrides?: Map<string, string>;
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

  // 多图合并：显式 override 优先；否则按 role 顺序（primary first）逐角色收集——
  // 每角色优先取多角度参考 referenceImageUrls（三视图+定妆，与手动路径同规则），
  // 缺失时回退单张 canonicalImageUrl。此前只收 canonical 一张，workflow 自动
  // 路径的三视图全部没用上，与手动路径出图质量不对等。
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
      const urls = c.referenceImageUrls?.length
        ? c.referenceImageUrls
        : c.canonicalImageUrl
          ? [c.canonicalImageUrl]
          : [];

      // 朝向感知：该角色有三视图资产且传入朝向时，把匹配朝向的资产 URL
      // 排到本角色 URL 列表首位（其余顺序不变），让参考图第一张就是对的朝向。
      // 无 referenceAssets / 无 facing 时 orderedUrls === urls（零回归）。
      let orderedUrls = reorderByFacing(urls, c, options?.facing);

      // 换装定妆照覆盖（场景定妆照）：该角色有换装图时，置于其 URL 列表首位
      // （服装正确性优先于朝向视角），其余参考图保留在后并去重。
      const lookUrl = options?.lookOverrides?.get(c.id);
      if (lookUrl) {
        orderedUrls = [lookUrl, ...orderedUrls.filter((u) => u !== lookUrl)];
      }

      for (const url of orderedUrls) {
        if (!collectedUrls.includes(url)) collectedUrls.push(url);
      }
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
    shotType,
    options?.iterateMode
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

/**
 * 把角色三视图里「朝向匹配」的那张 URL 排到该角色 URL 列表首位（其余相对顺序不变）。
 * 仅当角色有 referenceAssets 且传入 facing 时生效；否则原样返回（零回归）。
 * 匹配到的 URL 若不在原 urls 里（理论上应在），也会被提到最前，保证参考图第一张是对的朝向。
 */
function reorderByFacing(
  urls: string[],
  char: SceneCharacterInfo,
  facing?: Facing
): string[] {
  if (!facing || !char.referenceAssets?.length) return urls;
  const matchUrl = pickAssetUrlForFacing(char.referenceAssets, facing);
  if (!matchUrl) return urls;
  const rest = urls.filter((u) => u !== matchUrl);
  // 去重保留：matchUrl 置首，其余顺序不变
  return [matchUrl, ...rest];
}

function buildStrategyPrompt(
  basePrompt: string,
  characters: SceneCharacterInfo[],
  strategy: GenerationStrategy,
  shotType?: string,
  iterateMode?: boolean
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
    // 迭代模式：参考图是上一版整图（含背景/构图/光线），措辞改为
    // 「以整图为基础、保留构图与身份、按需改动」——默认「锁死外貌」会与
    // 用户「改成夜晚/换服装」等改动类指令冲突。
    parts.push(
      iterateMode
        ? "IMPORTANT: use the reference image as the base, preserve the overall composition and character identity, apply the requested change while keeping everything else consistent"
        : "IMPORTANT: Keep character appearance exactly as described above, consistent facial features, consistent hairstyle, consistent clothing"
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
