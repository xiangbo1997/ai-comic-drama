/**
 * Workflow 数据库辅助（从 `workflow-engine.ts` 的「数据库辅助」小节平移，纯搬运无行为变更）
 *
 * - `saveScenesToProject`：Step 1 后把解析结果幂等 diff-upsert 进 Scene 表
 * - `backfillSelectedCharacterIds`：Step 2 角色回写后补匹配空的角色锚点
 * - `updateSceneImage`：出图成功后回写 imageUrl / imageStatus
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveSelectedCharacterIds } from "../match-scene-character";
import type { ScriptArtifact, ImageArtifact } from "../types";

/**
 * 保存分镜到项目（Stage 2.6：幂等 diff-upsert）
 *
 * 原先是 deleteMany + createMany —— 每次 workflow 重跑都会丢失已生成的 imageUrl/videoUrl/audioUrl。
 * 现在按 order 匹配：
 * - 同一 order：update 文本字段（shotType/description/...）但**保留**已生成的 URL 与状态
 * - 新增 order：create（默认 PENDING）
 * - 被删除的 order（新 script 比老 script 少）：删除多余
 *
 * 这样重跑 workflow 时，已完成图像/视频的分镜不需要重新生成。
 */
export async function saveScenesToProject(
  projectId: string,
  script: ScriptArtifact
): Promise<void> {
  const existing = await prisma.scene.findMany({
    where: { projectId },
    select: { id: true, order: true },
  });
  const existingByOrder = new Map(existing.map((s) => [s.order, s.id]));
  const newOrders = new Set<number>();

  // C3：一次性预加载项目角色，按分镜 characters 名单匹配 selectedCharacterId（出图角色锚点）。
  // 与手动路径 scenes/route.ts 同语义——此前一键 workflow 漏写该字段，导致自动项目所有
  // 分镜 selectedCharacterId 恒 null，出图丢失角色一致性。角色回写（C1）已在本步之前执行，
  // 故这里能匹配到刚建档的角色。
  const projectCharacters = await prisma.character.findMany({
    where: { projects: { some: { projectId } } },
    select: { id: true, name: true },
  });

  for (let idx = 0; idx < script.scenes.length; idx++) {
    const s = script.scenes[idx];
    const order = idx + 1;
    newOrders.add(order);
    const sceneId = existingByOrder.get(order);

    // 镜头语言字段（LLM 解析产出，落库供出图/视频 prompt）
    const cinematics = {
      cameraAngle: s.cameraAngle ?? null,
      lighting: s.lighting ?? null,
      composition: s.composition ?? null,
      colorPalette: s.colorPalette ?? null,
      cameraMovement: s.cameraMovement ?? null,
      // 运动节拍：LLM 导演产出，喂视频 prompt 的 Action 段
      actionBeat: s.actionBeat ?? null,
      // 地点标签：同一物理地点的分镜共用同一短标签，供场景锚定图分组（环境一致性）
      locationKey: s.locationKey ?? null,
      // 尾帧衔接下一镜：LLM 解析产出（linkNext），映射到 videoLinkNext，供视频生成走 FL 首尾帧插值。
      // 与手动解析路径（scenes/route.ts）对齐——此前一键 workflow 丢弃该字段，导致同款输入两条路径行为不一致。
      videoLinkNext: Boolean(s.linkNext),
      // 分镜级换装标注（Json）：LLM 解析产出，供场景定妆照换装（与 scenes 路由同款空值语义）
      characterOutfits:
        Array.isArray(s.characterOutfits) && s.characterOutfits.length > 0
          ? (s.characterOutfits as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    };

    // C3：按分镜角色名单取全部命中角色 id（与手动路径一致）——复数驱动 UI 自动
    // 高亮与多角色参考图合成，首个命中兼容单数锚点
    const selectedCharacterIds = resolveSelectedCharacterIds(
      projectCharacters,
      s.characters
    );
    const selectedCharacterId = selectedCharacterIds[0] ?? null;

    if (sceneId) {
      // 更新文本字段；不触碰 imageUrl/videoUrl/audioUrl 与三个 status
      await prisma.scene.update({
        where: { id: sceneId },
        data: {
          shotType: s.shotType,
          description: s.description,
          dialogue: s.dialogue,
          narration: s.narration,
          emotion: s.emotion,
          duration: s.duration,
          selectedCharacterId,
          selectedCharacterIds,
          ...cinematics,
        },
      });
    } else {
      await prisma.scene.create({
        data: {
          projectId,
          order,
          shotType: s.shotType,
          description: s.description,
          dialogue: s.dialogue,
          narration: s.narration,
          emotion: s.emotion,
          duration: s.duration,
          selectedCharacterId,
          selectedCharacterIds,
          ...cinematics,
          imageStatus: "PENDING",
          videoStatus: "PENDING",
          audioStatus: "PENDING",
        },
      });
    }
  }

  // 删除多余的 order（新 script 长度缩短时）
  const stale = existing
    .filter((s) => !newOrders.has(s.order))
    .map((s) => s.id);
  if (stale.length > 0) {
    await prisma.scene.deleteMany({ where: { id: { in: stale } } });
  }
}

/**
 * C3 回填：为 selectedCharacterId 仍为空的分镜补匹配角色（角色圣经回写 C1 之后调用）。
 *
 * saveScenesToProject 在 Step 1 已尝试匹配，但纯自动项目那时角色尚未建档（C1 在 Step 2
 * 回写）→ 恒 null。此处对空值分镜再匹配一次刚建档的角色补上；已有值的分镜绝不覆盖
 * （尊重手动路径落库 / 用户在编辑器的选择）。按 order 对齐 script.scenes 的角色名单。
 */
export async function backfillSelectedCharacterIds(
  projectId: string,
  script: ScriptArtifact
): Promise<void> {
  const projectCharacters = await prisma.character.findMany({
    where: { projects: { some: { projectId } } },
    select: { id: true, name: true },
  });
  if (projectCharacters.length === 0) return;

  // 只取单数与复数均为空的分镜，避免覆盖已有值（含用户手动勾选）
  const scenes = await prisma.scene.findMany({
    where: {
      projectId,
      selectedCharacterId: null,
      selectedCharacterIds: { isEmpty: true },
    },
    select: { id: true, order: true },
  });
  if (scenes.length === 0) return;

  for (const scene of scenes) {
    // saveScenesToProject 用 order = idx + 1，故 script.scenes[order - 1] 对齐
    const scriptScene = script.scenes[scene.order - 1];
    if (!scriptScene) continue;
    const selectedCharacterIds = resolveSelectedCharacterIds(
      projectCharacters,
      scriptScene.characters
    );
    if (selectedCharacterIds.length === 0) continue;
    await prisma.scene.update({
      where: { id: scene.id },
      data: {
        selectedCharacterId: selectedCharacterIds[0],
        selectedCharacterIds,
      },
    });
  }
}

export async function updateSceneImage(
  projectId: string,
  image: ImageArtifact
): Promise<string | null> {
  const scene = await prisma.scene.findFirst({
    where: { projectId, order: image.sceneId },
  });

  if (scene) {
    await prisma.scene.update({
      where: { id: scene.id },
      data: {
        imageUrl: image.imageUrl,
        imageStatus: "COMPLETED",
      },
    });
    return scene.id;
  }
  return null;
}
