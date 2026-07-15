/**
 * 角色圣经回写 Character 表（C1）——持久化侧（含 prisma 交互）。
 *
 * 背景：CharacterBibleAgent 产出完整画像（gender/appearance/description），但
 * workflow 此前只 artifacts.set，不写 prisma.character。出图阶段的
 * resolveProjectCharacters 又从 DB 读角色 —— 纯自动项目（用户没手动建角色）读回空，
 * 导致自动 workflow 出图丢失全部角色画像/外貌，人物一致性崩坏。
 *
 * 本模块在 bible 步骤完成后把每个 bible 条目按名匹配项目已关联角色：
 * - 命中已有角色：**只补空字段**（gender/age/description 为 null 才写；
 *   CharacterAppearance 不存在才 create，存在则只补其中为 null 的字段）——
 *   绝不覆盖用户手改数据。
 * - 未命中：创建 Character（含画像 + CharacterAppearance）并建 ProjectCharacter 关联。
 * - 幂等：按名查重，workflow 重试不重复建档。
 *
 * "只补空字段"纯决策逻辑抽在 character-bible-merge.ts（无 prisma，全量单测覆盖）。
 */

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import type { CharacterBible, CharacterBibleEntry } from "./types";
import {
  normalizeBibleValue,
  mergeNullableFields,
  mergeAppearanceFields,
  bibleAppearanceToFields,
  buildNewAppearanceData,
} from "./character-bible-merge";

const log = createLogger("agent:character-bible-persist");

/**
 * 把角色圣经回写到项目角色（Character + CharacterAppearance + ProjectCharacter）。
 *
 * 静默失败：任一角色回写异常只记 warn，不抛错、不阻断 workflow 后续步骤
 * （出图仍能靠 bible artifact / 已有 DB 角色运行）。
 */
export async function persistCharacterBible(
  projectId: string,
  bible: CharacterBible
): Promise<void> {
  // 用户归属：Character.userId 取项目 owner
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  if (!project) {
    log.warn("回写跳过：项目不存在", { projectId });
    return;
  }
  const ownerUserId = project.userId;

  for (const entry of bible.characters) {
    const name = entry.name?.trim();
    if (!name) continue;
    try {
      await upsertBibleCharacter(projectId, ownerUserId, entry);
    } catch (err) {
      // 单角色回写失败静默降级：不阻断其余角色与 workflow 后续步骤
      log.warn(`角色圣经回写失败「${name}」，跳过`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * 单角色回写：命中已有则只补空字段，未命中则建档 + 关联。事务包住单角色写入。
 */
async function upsertBibleCharacter(
  projectId: string,
  ownerUserId: string,
  entry: CharacterBibleEntry
): Promise<void> {
  const name = entry.name.trim();
  const bibleTop = {
    gender: normalizeBibleValue(entry.appearance.gender),
    age: normalizeBibleValue(entry.appearance.age),
    description: normalizeBibleValue(entry.description),
  };
  const bibleAppearance = bibleAppearanceToFields(entry.appearance);

  // 幂等查重：项目已关联的同名角色（精确同名，忽略大小写）。命中即"补空"，
  // 未命中才建档，避免 workflow 重试重复建档。
  const existing = await prisma.character.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      projects: { some: { projectId } },
    },
    select: {
      id: true,
      gender: true,
      age: true,
      description: true,
      appearance: {
        select: {
          id: true,
          hairStyle: true,
          hairColor: true,
          faceShape: true,
          eyeColor: true,
          bodyType: true,
          skinTone: true,
          height: true,
          accessories: true,
          freeText: true,
        },
      },
    },
  });

  if (existing) {
    // 命中已有角色：只补顶层空字段 + 外貌空字段（绝不覆盖用户手改数据）
    const topPatch = mergeNullableFields(
      {
        gender: existing.gender,
        age: existing.age,
        description: existing.description,
      },
      bibleTop
    );

    await prisma.$transaction(async (tx) => {
      if (Object.keys(topPatch).length > 0) {
        await tx.character.update({
          where: { id: existing.id },
          data: topPatch,
        });
      }
      if (!existing.appearance) {
        // 外貌不存在才 create（全新写入完整字段）
        await tx.characterAppearance.create({
          data: {
            characterId: existing.id,
            ...buildNewAppearanceData(bibleAppearance),
          },
        });
      } else {
        // 外貌存在则只补其中为 null 的字段
        const appPatch = mergeAppearanceFields(
          existing.appearance,
          bibleAppearance
        );
        if (Object.keys(appPatch).length > 0) {
          await tx.characterAppearance.update({
            where: { id: existing.appearance.id },
            data: appPatch,
          });
        }
      }
    });
    return;
  }

  // 未命中：建 Character（含画像 + 外貌）+ ProjectCharacter 关联，事务包住
  await prisma.$transaction(async (tx) => {
    const created = await tx.character.create({
      data: {
        name,
        userId: ownerUserId,
        gender: bibleTop.gender,
        age: bibleTop.age,
        description: bibleTop.description,
        appearance: {
          create: buildNewAppearanceData(bibleAppearance),
        },
      },
      select: { id: true },
    });
    // 关联到项目（幂等：复合唯一约束 [projectId, characterId]，重复用 upsert 语义规避）
    await tx.projectCharacter.upsert({
      where: {
        projectId_characterId: { projectId, characterId: created.id },
      },
      create: { projectId, characterId: created.id },
      update: {},
    });
  });
}
