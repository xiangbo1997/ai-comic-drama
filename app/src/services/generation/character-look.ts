/**
 * 换装定妆照解析器（场景定妆照 · 换装变体）
 *
 * 借鉴 HKUDS ViMax 的 static/dynamic features 分离 + 场景定妆衍生
 * （generate_scene_portrait）：角色的 canonicalImageUrl / 三视图把服装钉死，
 * 剧情换装（婚纱/战损/雨夜湿透/睡衣）时参考图与画面描述冲突，模型要么穿错衣服
 * 要么身份漂移。这里把「身份锚（不变）」与「服装（可变）」分离：以定妆锚为参考做
 * 编辑式生成，只换服装、保持脸/发型/身形/身份不变，衍生出「场景定妆照」，
 * 供出图编排器当该角色在此分镜的参考图。
 *
 * 解析优先级：
 * ① 用户预设优先：clothingPresets 里按 name 与 outfit 模糊匹配，命中且有 imageRef
 *    → 直接返回 imageRef（用户手挑的参考图最权威）。
 * ② 缓存命中：CharacterLook 表按 (characterId, outfitKey) 查，imageUrl 非空 → 返回。
 * ③ 自动衍生：无 canonicalImageUrl → null（没身份锚没法换装）；否则以 canonical 为
 *    参考编辑式生成，成功后 upsert CharacterLook 缓存。
 *
 * 【计费决策】v1 换装定妆生成不额外扣积分——与 tail-frame / face-validator 同类的
 * 内部质量增强开销（消耗外部 API 配额但不计入用户积分）。每角色每套衣服只生成一次
 * （缓存表兜底），成本可控。
 *
 * 增强项语义：全函数 try/catch，任何失败 log.warn 后返回 null，绝不阻断出图。
 */

import { Prisma } from "@prisma/client";
import { generateImage } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { getSimpleStylePrefix, getStylePack } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  matchClothingPreset,
  normalizeOutfitKey,
  type LookClothingPreset,
} from "./character-look-match";
import type { AIServiceConfig } from "@/types";

const log = createLogger("services:generation:character-look");

// 纯匹配/规整逻辑拆到 character-look-match.ts（无 prisma 依赖，可单测），此处再导出
export {
  matchClothingPreset,
  normalizeOutfitKey,
  type LookClothingPreset,
} from "./character-look-match";

/** 换装定妆照解析入参 */
export interface ResolveCharacterLookArgs {
  /** 角色 DB id（缓存表主键之一） */
  characterId: string;
  /** 角色名（日志/prompt 用） */
  characterName: string;
  /** 分镜级换装短语（LLM 解析产出，如 "白色婚纱"） */
  outfit: string;
  /** 角色定妆锚：换装的身份基底，缺省则无法自动衍生 */
  canonicalImageUrl?: string;
  /** 用户预设服装（外观编辑器手填 / AI 起草），命中且带 imageRef 时最权威 */
  clothingPresets?: LookClothingPreset[] | null;
  /** 图像生成配置（由调用方 getUserImageConfig 取得） */
  imageConfig: AIServiceConfig;
  /** 上传归属（storage 路径与审计用） */
  userId: string;
  projectId?: string;
  /** 项目风格（拼到 prompt 尾部保持画风一致） */
  style?: string | null;
}

/**
 * 编辑式换装 prompt：英文框架包裹服装短语。
 * 明确「基于参考图（定妆锚）换成指定服装」，脸/发型/身形/身份保持不变，
 * 只换服装。full-body 正面、纯白背景（定妆照规格）。style 后缀保持画风一致。
 *
 * 画风包注入（画风一致性增强）：命中完整画风包时，把该包的角色定妆规则
 * （characterRules，线条/头身比/肤感/背景）与分层色彩系统（colorSystem）作为
 * 「画风基线」追加，让换装图的画风与三视图/定妆照对齐，而非仅靠短前缀。
 * legacy 平面风格（characterRules 为空）自动跳过，行为不变。
 */
function buildLookPrompt(outfit: string, style?: string | null): string {
  const base =
    `Based on the reference image, generate the SAME character wearing: ${outfit}. ` +
    `Full-body, front view, plain white background. ` +
    `Keep the face, hairstyle, body shape and identity EXACTLY the same as the reference; ONLY change the clothing.`;
  if (!style) return base;

  const stylePrefix = getSimpleStylePrefix(style);
  const pack = getStylePack(style);
  const packBaseline = [pack.characterRules, pack.colorSystem]
    .filter((s) => s.trim())
    .join(" ");
  const packBlock = packBaseline ? ` 画风基线：${packBaseline}` : "";
  return `${base} ${stylePrefix}${packBlock}`;
}

/**
 * 解析角色在某分镜的换装定妆照 URL。
 *
 * @returns 命中预设 imageRef / 缓存 / 自动衍生成功 → 定妆照 URL；
 *   无身份锚 / 内容不安全 / 生成失败等任何情况 → null（调用方走原参考图路径）。
 */
export async function resolveCharacterLookUrl(
  args: ResolveCharacterLookArgs
): Promise<string | null> {
  const {
    characterId,
    characterName,
    outfit,
    canonicalImageUrl,
    clothingPresets,
    imageConfig,
    style,
  } = args;

  try {
    const trimmedOutfit = outfit.trim();
    if (!trimmedOutfit) return null;

    // ① 用户预设优先：命中且带 imageRef → 直接用用户手挑的参考图（最权威）
    const matched = matchClothingPreset(clothingPresets, trimmedOutfit);
    if (matched?.imageRef?.trim()) {
      log.debug("换装命中用户预设 imageRef", {
        characterName,
        outfit: trimmedOutfit,
      });
      return matched.imageRef.trim();
    }

    const outfitKey = normalizeOutfitKey(trimmedOutfit);

    // ② 缓存命中：同角色同套衣服只生成一次
    const cached = await prisma.characterLook.findUnique({
      where: { characterId_outfitKey: { characterId, outfitKey } },
    });
    if (cached?.imageUrl) {
      log.debug("换装命中缓存", { characterName, outfit: trimmedOutfit });
      return cached.imageUrl;
    }

    // ③ 自动衍生：无身份锚无法换装
    if (!canonicalImageUrl) {
      log.debug("无定妆锚，跳过换装衍生", {
        characterName,
        outfit: trimmedOutfit,
      });
      return null;
    }

    // 换装描述优先用命中预设的 description（更完整），否则用 outfit 短语。
    // 是 LLM / 用户产物，进图像 prompt 前必须过内容安全。
    const outfitDescForPrompt = matched?.description?.trim() || trimmedOutfit;
    const safety = await contentSafetyMiddleware(outfitDescForPrompt, "image");
    if (!safety.safe) {
      log.warn("换装描述未通过内容安全，跳过换装衍生", {
        characterName,
        reason: safety.reason,
      });
      return null;
    }
    const safeDesc = safety.sanitizedText || outfitDescForPrompt;

    const prompt = buildLookPrompt(safeDesc, style);

    // 以定妆锚为参考编辑式生成：只换服装，脸/发型/身形/身份由参考图锚定
    const rawUrl = await generateImage({
      prompt,
      referenceImage: canonicalImageUrl,
      style: style ?? undefined,
      config: imageConfig,
    });
    if (!rawUrl) {
      log.warn("换装定妆生成返回空 URL，跳过", {
        characterName,
        outfit: trimmedOutfit,
      });
      return null;
    }

    // 转存自有存储（对齐 tail-frame）：provider 可能返回临时受限域名 URL，
    // 会过期且下游够不到。转存失败降级沿用原始 URL，不因转存失败丢掉整张换装图。
    let finalUrl = rawUrl;
    if (isStorageConfigured()) {
      try {
        finalUrl = await uploadFileFromUrl(rawUrl, {
          fileName: `character_${characterId}_look_${Date.now()}.jpg`,
          contentType: "image/jpeg",
          fileType: "image",
          userId: args.userId,
          projectId: args.projectId,
        });
      } catch (uploadErr) {
        log.warn("换装定妆转存失败，沿用 provider URL", {
          characterName,
          error: uploadErr instanceof Error ? uploadErr.message : uploadErr,
        });
      }
    }

    // upsert 缓存：并发两条同角色同套衣服的请求可能同时未命中缓存、各自生成，
    // 写入时撞 @@unique(characterId, outfitKey) → P2002。catch 后重查返回已有记录，
    // 避免抛错阻断出图（此时对方已写好，直接复用）。
    try {
      await prisma.characterLook.upsert({
        where: { characterId_outfitKey: { characterId, outfitKey } },
        create: {
          characterId,
          outfitKey,
          outfitDesc: trimmedOutfit,
          imageUrl: finalUrl,
        },
        update: { imageUrl: finalUrl, outfitDesc: trimmedOutfit },
      });
    } catch (upsertErr) {
      if (
        upsertErr instanceof Prisma.PrismaClientKnownRequestError &&
        upsertErr.code === "P2002"
      ) {
        const existing = await prisma.characterLook.findUnique({
          where: { characterId_outfitKey: { characterId, outfitKey } },
        });
        if (existing?.imageUrl) return existing.imageUrl;
      } else {
        // 缓存写入失败不影响本次结果：本次已拿到 finalUrl，照常返回
        log.warn("换装定妆缓存写入失败（不影响本次出图）", {
          characterName,
          error:
            upsertErr instanceof Error ? upsertErr.message : String(upsertErr),
        });
      }
    }

    log.info("换装定妆照已衍生", {
      characterName,
      outfit: trimmedOutfit,
    });
    return finalUrl;
  } catch (err) {
    log.warn("换装定妆解析失败，跳过（不阻断出图）", {
      characterName: args.characterName,
      outfit: args.outfit,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
