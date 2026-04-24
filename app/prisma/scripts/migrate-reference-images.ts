/**
 * 数据迁移脚本：将 Character.referenceImages[] 迁移到 CharacterReferenceAsset 表
 *
 * 使用方式：npx tsx prisma/scripts/migrate-reference-images.ts
 *
 * 迁移逻辑：
 * - 遍历所有 Character，读取 referenceImages 数组
 * - 数组第一项标记为 canonical（定妆照）
 * - 其余标记为 ai_generated
 * - 跳过已有 referenceAssets 的角色（幂等）
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const characters = await prisma.character.findMany({
    select: {
      id: true,
      name: true,
      referenceImages: true,
      referenceAssets: { select: { id: true } },
    },
  });

  let migrated = 0;
  let skipped = 0;

  for (const char of characters) {
    // 跳过已迁移的角色
    if (char.referenceAssets.length > 0) {
      skipped++;
      continue;
    }

    const images = char.referenceImages as string[];
    if (images.length === 0) {
      skipped++;
      continue;
    }

    const assets = images.map((url, index) => ({
      characterId: char.id,
      url,
      sourceType: index === 0 ? "canonical" : ("ai_generated" as const),
      isCanonical: index === 0,
      pose: index === 0 ? "front" : null,
    }));

    await prisma.characterReferenceAsset.createMany({ data: assets });
    migrated++;
    console.log(`Migrated ${images.length} images for "${char.name}" (${char.id})`);
  }

  console.log(`\nDone: ${migrated} characters migrated, ${skipped} skipped.`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
