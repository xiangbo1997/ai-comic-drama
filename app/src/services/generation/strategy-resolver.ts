/**
 * 策略选择器
 * 根据 Provider 能力、角色数量、景别选择最优生成策略
 */

import {
  getImageProviderCapability,
  describeImageCapabilityOverride,
} from "@/services/ai/provider-factory";
import { pickAssetUrlForFacing, type Facing } from "./facing";
import { buildCanonicalAppearanceText } from "@/lib/prompts/canonical-appearance";
import { createLogger } from "@/lib/logger";
import type { AIServiceConfig } from "@/types";
import type {
  SceneCharacterInfo,
  StrategyDecision,
  GenerationStrategy,
} from "./types";

const log = createLogger("services:generation:strategy-resolver");

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
  // 能力判定必须带上模型名：protocol 只管路由，真实能力由模型决定
  // （OpenAI 兼容网关代理非 OpenAI 模型时二者解耦，见 provider-factory
  // 的 MODEL_CAPABILITY_OVERRIDES 注释）。
  const capability = getImageProviderCapability(
    imageConfig.protocol,
    imageConfig.model
  );

  const primaryCharacter = characters.find((c) => c.role === "primary");
  const canonicalImage = primaryCharacter?.canonicalImageUrl;

  // 多图合并：显式 override 与服务端逐角色收集【合并】而非互斥。
  //
  // 语义选择：override 占前排，服务端收集的角色锚图追加在后（去重）。
  // 理由：① override 是用户在 UI 里显式点选的参考图，对只支持单张参考图的
  // provider 而言只有第一张生效，因此它必须保持在首位——否则「我选的图不生效」
  // 就是功能回归；② 旧实现在命中 override 时整段跳过服务端收集，三视图/朝向
  // 重排/canonical 回退链全部失效，导致手动路径（传 override）与 workflow 路径
  // （不传）出图质量不对等，正是角色一致性漂移的断点之一。合并后多图 provider
  // 既吃到用户指定图，又能拿到身份锚点；单图 provider 行为与合并前完全一致。
  //
  // 每角色优先取多角度参考 referenceImageUrls（三视图+定妆，与手动路径同规则），
  // 缺失时回退单张 canonicalImageUrl。
  const collectedUrls: string[] = [];
  const pushUnique = (url: string): void => {
    if (url && !collectedUrls.includes(url)) collectedUrls.push(url);
  };

  const override = options?.referenceImagesOverride ?? [];
  for (const url of override) pushUnique(url);

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

    for (const url of orderedUrls) pushUnique(url);
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

  // 能力错配防呆：带了参考图但当前模型不吃——绝不静默丢弃。
  // 服务端 warn 落日志，同时把中文告知挂到 decision.warnings，由上游透出到
  // 客户端（参考图被忽略时人物一致性根本无从保证，用户必须知道要换模型）。
  const warnings: string[] = [];
  if (collectedUrls.length > 0 && !capability.supportsReferenceImage) {
    const overrideReason = describeImageCapabilityOverride(
      imageConfig.protocol,
      imageConfig.model
    );
    // 文案面向终端用户：说清「发生了什么 + 后果 + 下一步做什么」。
    // 能力错配的失败是完全静默的（日志甚至还记 hasReference:true），这条告知是
    // 用户唯一能看见的信号，必须能让人知道去哪里改。
    const modelLabel = imageConfig.model || imageConfig.protocol;
    warnings.push(
      `当前图像模型（${modelLabel}）不支持参考图，角色一致性无法保证。` +
        `本次已递入的 ${collectedUrls.length} 张角色参考图被忽略，出图相当于纯文字生成。` +
        `建议在「AI 模型设置」里更换为支持参考图的模型（如 gpt-image 系或 Gemini 3 Pro Image）。` +
        (overrideReason ? `（原因：${overrideReason}）` : "")
    );
    log.warn("参考图被丢弃：当前模型不支持参考图", {
      protocol: imageConfig.protocol,
      model: imageConfig.model,
      droppedReferenceCount: collectedUrls.length,
      overrideReason,
    });
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
    warnings: warnings.length > 0 ? warnings : undefined,
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

/**
 * 角色外貌特征：收口到冻结外貌单一真源（lib/prompts/canonical-appearance.ts）。
 *
 * 此前这里是全项目**第三套**外貌拼装逻辑，与定妆照路径（buildAppearanceFeatures）
 * 和场景增强路径（buildEnhancedPrompt）各不相同，且策略互相矛盾——本函数在有
 * 结构化 appearance 时会**丢掉** description，而场景增强恰恰只用 description。
 * 结果：同一角色在定妆照 prompt 里是 `navy blue bomber jacket, amber eyes`，
 * 到分镜 prompt 只剩一句模糊的「蓝色夹克」，模型每镜画出不同的人。
 *
 * 冻结真源保证同一角色在所有出图路径上产出**逐字相同**的外貌文本
 * （结构化字段与 description 互补而非互斥），这是跨镜头一致性的地基。
 */
function buildCharacterFeatures(char: SceneCharacterInfo): string {
  return buildCanonicalAppearanceText(char);
}
