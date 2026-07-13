import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import type { GenerationParams } from "@/types";
import { clampSceneDuration } from "@/services/generation/video-segmenter";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]:scenes");

/**
 * 重解析分镜后，把 generationParams 中按 sceneId 键控的分镜级配置
 * （字幕位置 / 贴图 / 滤镜）从旧 sceneId 重写为新 sceneId。
 *
 * 背景：重解析走 deleteMany + createMany，新分镜拿到全新 cuid → 这些
 * 配置的 sceneId 全部失联，导出时按新 sceneId 匹配 miss → 用户精调的贴图/
 * 滤镜/逐镜字幕位置全部静默丢失，孤儿数据还永久滞留（a1 审计 P0-1，
 * 正是「预览必须反映所有导出效果」的雷区）。
 *
 * 用「旧 order → 新 sceneId」桥接：旧配置的 sceneId 先映射回它当时的
 * order，再映射到同 order 的新 sceneId。分镜数变少导致 order 越界、或
 * 该 order 已无对应新分镜的条目一律丢弃。transitions 按相邻顺序关联
 * （非 sceneId），分镜数变化时截断到 新分镜数-1。
 */
function remapGenerationParams(
  params: GenerationParams | null | undefined,
  oldSceneIdToOrder: Map<string, number>,
  orderToNewSceneId: Map<number, string>
): { next: GenerationParams; changed: boolean } {
  const next: GenerationParams = { ...(params ?? {}) };
  let changed = false;

  const remapByScene = <T extends { sceneId: string }>(
    list: T[] | undefined
  ): T[] | undefined => {
    if (!list || list.length === 0) return list;
    const mapped = list
      .map((item) => {
        const order = oldSceneIdToOrder.get(item.sceneId);
        if (order === undefined) return null;
        const newId = orderToNewSceneId.get(order);
        if (!newId) return null;
        return { ...item, sceneId: newId };
      })
      .filter((x): x is T => x !== null);
    if (mapped.length !== list.length) changed = true;
    return mapped;
  };

  const sp = remapByScene(next.subtitlePositions);
  if (sp !== next.subtitlePositions) next.subtitlePositions = sp;
  const st = remapByScene(next.stickers);
  if (st !== next.stickers) next.stickers = st;
  const se = remapByScene(next.sceneEffects);
  if (se !== next.sceneEffects) next.sceneEffects = se;

  // transitions 按相邻分镜顺序（k 与 k+1 之间），最多 新分镜数-1 项
  const maxTransitions = Math.max(0, orderToNewSceneId.size - 1);
  if (next.transitions && next.transitions.length > maxTransitions) {
    next.transitions = next.transitions.slice(0, maxTransitions);
    changed = true;
  }

  return { next, changed };
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 在内存中按名称匹配角色（支持模糊匹配）。
 *
 * 改自原 findCharacterByName 的逐角色 DB 查询版本：批量保存分镜时，
 * 每个分镜的每个角色名都查一次 DB（N+1，~150 次串行往返）。改为
 * POST 入口一次性预加载项目全部角色到内存，逐分镜在内存里匹配。
 */
function matchCharacterByName(
  characters: Array<{ id: string; name: string }>,
  characterName: string
): { id: string } | null {
  const lower = characterName.toLowerCase();
  // 1. 精确匹配（忽略大小写）
  const exact = characters.find((c) => c.name.toLowerCase() === lower);
  if (exact) return { id: exact.id };
  // 2. 模糊匹配（角色名称包含输入的名称）
  const contains = characters.find((c) => c.name.toLowerCase().includes(lower));
  if (contains) return { id: contains.id };
  // 3. 反向模糊匹配（输入的名称包含角色名称）
  const reverse = characters.find((c) => lower.includes(c.name.toLowerCase()));
  return reverse ? { id: reverse.id } : null;
}

// 获取项目的所有分镜
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const scenes = await prisma.scene.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
      include: {
        sceneCharacters: {
          include: {
            character: {
              select: {
                id: true,
                name: true,
                description: true,
                referenceImages: true,
                voiceId: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(scenes);
  } catch (error) {
    log.error("Get scenes error:", error);
    return NextResponse.json(
      { error: "Failed to get scenes" },
      { status: 500 }
    );
  }
}

// 批量创建/更新分镜
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { scenes } = await request.json();

    if (!Array.isArray(scenes)) {
      return NextResponse.json(
        { error: "Scenes must be an array" },
        { status: 400 }
      );
    }

    // 一次性预加载项目全部角色到内存（消除原逐角色名查 DB 的 N+1）
    const projectCharacters = await prisma.character.findMany({
      where: { projects: { some: { projectId: id } } },
      select: { id: true, name: true },
    });

    // 在内存里完成角色匹配，组装好待插入数据
    const sceneData = scenes.map((raw, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene = raw as any;
      const sceneCharacters: string[] = scene.characters || [];
      let selectedCharacterId: string | null = null;
      for (const characterName of sceneCharacters) {
        const matched = matchCharacterByName(projectCharacters, characterName);
        if (matched) {
          selectedCharacterId = matched.id; // 第一个匹配的角色用于图像生成
          break;
        }
      }
      return {
        projectId: id,
        order: i,
        shotType: scene.shotType || null,
        description: scene.description || "",
        dialogue: scene.dialogue || null,
        narration: scene.narration || null,
        emotion: scene.emotion || "neutral",
        // 时长钳到 1–60 整数：分镜时长上限即视频分段上限，防越界值直达 DB/规划器
        duration: clampSceneDuration(scene.duration ?? 3),
        selectedCharacterId,
        // 镜头语言：LLM 解析产出，此前落库被丢弃 → 出图缺电影感
        cameraAngle: scene.cameraAngle || null,
        lighting: scene.lighting || null,
        composition: scene.composition || null,
        colorPalette: scene.colorPalette || null,
        cameraMovement: scene.cameraMovement || null,
        // 运动节拍：LLM 导演产出，喂视频 prompt 的 Action 段
        actionBeat: scene.actionBeat || null,
        // 地点标签：LLM 解析产出，供场景锚定图（环境一致性）分组
        locationKey: scene.locationKey || null,
        // 分镜级换装标注（Json）：LLM 解析产出，供场景定妆照换装。
        // 有数组用 InputJsonValue，缺省用 JsonNull（Prisma Json 空值语义）。
        characterOutfits:
          Array.isArray(scene.characterOutfits) &&
          scene.characterOutfits.length > 0
            ? (scene.characterOutfits as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      };
    });

    // 重建前抓「旧 sceneId → order」映射，用于事后把 generationParams 中
    // 按 sceneId 键控的配置桥接到新分镜（a1 P0-1）。
    const oldScenes = await prisma.scene.findMany({
      where: { projectId: id },
      select: { id: true, order: true },
    });
    const oldSceneIdToOrder = new Map(oldScenes.map((s) => [s.id, s.order]));

    // 事务化「删旧 + 建新」：中断则整体回滚，不会出现「删了旧的但新的
    // 没建成」的半残状态导致分镜全丢（arch-data P0-1）。
    await prisma.$transaction([
      prisma.scene.deleteMany({ where: { projectId: id } }),
      ...(sceneData.length > 0
        ? [prisma.scene.createMany({ data: sceneData })]
        : []),
    ]);

    // createMany 不返回记录，按 order 回读新建分镜返回前端
    const createdScenes = await prisma.scene.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
    });

    // 把分镜级配置（字幕位置/贴图/滤镜/转场）从旧 sceneId 重写到新 sceneId，
    // 避免用户精调成果在重解析后静默丢失、孤儿数据滞留。
    const orderToNewSceneId = new Map(
      createdScenes.map((s) => [s.order, s.id])
    );
    const { next: remappedParams, changed } = remapGenerationParams(
      project.generationParams as GenerationParams | null,
      oldSceneIdToOrder,
      orderToNewSceneId
    );
    if (changed) {
      await prisma.project.update({
        where: { id },
        data: {
          generationParams: remappedParams as unknown as Prisma.InputJsonValue,
        },
      });
      log.info(`Remapped generationParams sceneId refs for project ${id}`);
    }

    return NextResponse.json(createdScenes, { status: 201 });
  } catch (error) {
    log.error("Create scenes error:", error);
    return NextResponse.json(
      { error: "Failed to create scenes" },
      { status: 500 }
    );
  }
}
