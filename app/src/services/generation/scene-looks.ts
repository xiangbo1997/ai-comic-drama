/**
 * 分镜换装 → 场景定妆照解析（编排器接入层）
 *
 * 把分镜级换装标注（Scene.characterOutfits，LLM 解析产出）落到每个角色的
 * 换装定妆照：查 scene.characterOutfits → 按角色名匹配本镜角色 → 对每个匹配调
 * resolveCharacterLookUrl 拿换装图 → 汇成 lookOverrides（characterId→URL）+
 * prompt 子句。编排器据此把该角色参考图替换为换装图、并在 prompt 声明换装。
 *
 * 与场景锚定图同款「增强项」语义：全程 try/catch，任何异常返回空结果，
 * 绝不阻断出图。iterate 路径不调用本模块（迭代基底已含服装）。
 */

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { resolveCharacterLookUrl } from "./character-look";
import {
  parseOutfitEntries,
  matchOutfitToCharacter,
} from "./scene-looks-match";
import type { SceneCharacterInfo } from "./types";
import type { AIServiceConfig } from "@/types";

const log = createLogger("services:generation:scene-looks");

// 纯解析/匹配逻辑拆到 scene-looks-match.ts（无 prisma 依赖，可单测），此处再导出
export {
  parseOutfitEntries,
  matchOutfitToCharacter,
  type OutfitEntry,
} from "./scene-looks-match";

/** 分镜换装解析结果 */
export interface SceneLookResult {
  /** characterId → 换装定妆照 URL（供 buildReferenceCells / resolveStrategy 覆盖参考图） */
  lookOverrides: Map<string, string>;
  /** 换装 prompt 子句（进 effectivePrompt→cacheKey），多角色多条 */
  promptClauses: string[];
}

const EMPTY: SceneLookResult = {
  lookOverrides: new Map(),
  promptClauses: [],
};

/** 解析入参 */
export interface ResolveSceneLooksArgs {
  sceneId: string;
  characters: SceneCharacterInfo[];
  imageConfig: AIServiceConfig;
  userId: string;
  projectId?: string;
  style?: string | null;
}

/**
 * 解析本镜的换装定妆照。无 characterOutfits / 无匹配 / 全部衍生失败时返回空结果
 * （编排器零回归）。
 */
export async function resolveSceneCharacterLooks(
  args: ResolveSceneLooksArgs
): Promise<SceneLookResult> {
  try {
    const scene = await prisma.scene.findUnique({
      where: { id: args.sceneId },
      select: { characterOutfits: true },
    });
    const entries = parseOutfitEntries(scene?.characterOutfits);
    if (entries.length === 0) return EMPTY;

    const lookOverrides = new Map<string, string>();
    const promptClauses: string[] = [];

    for (const entry of entries) {
      const char = matchOutfitToCharacter(args.characters, entry.name);
      if (!char) continue;
      // 已为该角色解析过换装（同名多条）→ 跳过，避免重复生成
      if (lookOverrides.has(char.id)) continue;

      const lookUrl = await resolveCharacterLookUrl({
        characterId: char.id,
        characterName: char.name,
        outfit: entry.outfit,
        canonicalImageUrl: char.canonicalImageUrl,
        clothingPresets: char.clothingPresets,
        imageConfig: args.imageConfig,
        userId: args.userId,
        projectId: args.projectId,
        style: args.style,
      });

      if (lookUrl) {
        lookOverrides.set(char.id, lookUrl);
        // prompt 子句：进 effectivePrompt→cacheKey，声明本镜该角色的服装。
        promptClauses.push(
          `${char.name} wears ${entry.outfit} in this scene; follow the outfit shown in their reference.`
        );
      }
    }

    if (lookOverrides.size > 0) {
      log.info("分镜换装定妆照已解析", {
        sceneId: args.sceneId,
        count: lookOverrides.size,
      });
    }

    return { lookOverrides, promptClauses };
  } catch (err) {
    log.warn("分镜换装解析失败（不阻断出图）", {
      sceneId: args.sceneId,
      error: err instanceof Error ? err.message : String(err),
    });
    return EMPTY;
  }
}
