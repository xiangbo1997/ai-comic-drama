import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import type { GenerationParams } from "@/types";
import type {
  SceneEffect,
  SceneSfx,
  Transition,
  TransitionType,
} from "@/types/export-style";
import { MAX_EMPHASIS_SCENES } from "@/types/export-style";
import { resolveSfxTag } from "@/lib/sfx-library";
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
  // 音效同为 sceneId 键控（批1）：重解析后桥接到新分镜，防精调丢失/孤儿滞留
  const sf = remapByScene(next.sfx);
  if (sf !== next.sfx) next.sfx = sf;

  // 金句花字（批6）：emphasis 是「裸 sceneId 字符串数组」（非 {sceneId} 对象），
  // 需单独按 旧sceneId→order→新sceneId 桥接，去重清理越界/失联 id（同 remapByScene 逻辑）。
  if (next.emphasis && next.emphasis.length > 0) {
    const seen = new Set<string>();
    const mappedEmphasis: string[] = [];
    for (const oldId of next.emphasis) {
      const order = oldSceneIdToOrder.get(oldId);
      if (order === undefined) continue;
      const newId = orderToNewSceneId.get(order);
      if (!newId || seen.has(newId)) continue;
      seen.add(newId);
      mappedEmphasis.push(newId);
    }
    if (mappedEmphasis.length !== next.emphasis.length) changed = true;
    next.emphasis = mappedEmphasis;
  }

  // transitions 按相邻分镜顺序（k 与 k+1 之间），最多 新分镜数-1 项
  const maxTransitions = Math.max(0, orderToNewSceneId.size - 1);
  if (next.transitions && next.transitions.length > maxTransitions) {
    next.transitions = next.transitions.slice(0, maxTransitions);
    changed = true;
  }

  return { next, changed };
}

/**
 * 从分镜草稿聚合分镜间转场配置（剪辑节奏回归 · 批2）。
 *
 * 短剧脚本直转（DramaScriptPanel / 一键制片人 ProducerWizardDialog）两条路径都
 * POST 到本路由，故在此单点聚合，避免两处客户端各写一遍（全局一致性）。
 *
 * 语义：drama-to-scenes 产出的 scene.transition 是「本镜 → 下一镜」的出向转场；
 * generationParams.transitions[k] 描述「第 k 与 k+1 分镜之间」，故 transitions[k]
 * = 第 k 镜的出向转场（末镜无下一镜，其 transition 丢弃）。项数 = 分镜数 - 1。
 *
 * 至少有一镜携带 transition 才生成配置（全部缺席→返回 null，保持无配置状态，
 * 由导出/预览端回落硬切默认，不写空数组污染 generationParams）。
 */
function aggregateSceneTransitions(scenes: unknown[]): Transition[] | null {
  const gapCount = Math.max(0, scenes.length - 1);
  if (gapCount === 0) return null;

  let anyTransition = false;
  const transitions: Transition[] = Array.from({ length: gapCount }, (_, k) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = scenes[k] as any;
    const type = raw?.transition as TransitionType | undefined;
    if (type) {
      anyTransition = true;
      const duration =
        typeof raw?.transitionDuration === "number"
          ? raw.transitionDuration
          : 0.3;
      return { type, duration };
    }
    // 未指定的衔接：硬切（none）——与「无存储配置默认硬切」一致，
    // 但因为同批里有其它镜显式设了转场，这里需显式落项，避免它回落到 fade。
    return { type: "none" as TransitionType, duration: 0 };
  });

  return anyTransition ? transitions : null;
}

/**
 * 从分镜草稿聚合音效配置（声音设计 · 批1）。
 *
 * 解析层按克制纪律产出的 scene.sfx（[{tag, offsetSec}]）在此单点落到
 * generationParams.sfx（SceneSfx[] 按新建分镜 id 关联）——与转场聚合同模式。
 * tag 经 resolveSfxTag 解析（支持具体音效 id 与分类 id），未命中静默跳过；
 * 每镜最多取 2 条（服务端兜底解析层克制规则）。全部缺席返回 null（不写空数组）。
 */
function aggregateSceneSfx(
  scenes: unknown[],
  orderToNewSceneId: Map<number, string>
): SceneSfx[] | null {
  const result: SceneSfx[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = scenes[i] as any;
    const sceneId = orderToNewSceneId.get(i);
    if (!sceneId || !Array.isArray(raw?.sfx)) continue;
    let taken = 0;
    for (const item of raw.sfx) {
      if (taken >= 2) break; // 每镜 ≤2 条，服务端兜底
      const tag = typeof item?.tag === "string" ? item.tag : "";
      const entry = tag ? resolveSfxTag(tag) : undefined;
      if (!entry) continue;
      const offset =
        typeof item?.offsetSec === "number" && Number.isFinite(item.offsetSec)
          ? Math.max(0, item.offsetSec)
          : 0;
      result.push({ sceneId, sfxId: entry.id, offsetSec: offset });
      taken += 1;
    }
  }
  return result.length > 0 ? result : null;
}

/**
 * 从分镜草稿聚合金句花字分镜 id（成片包装 · 批6）。
 *
 * 解析层按克制纪律（每集 1-3 处）标注的 scene.emphasis === true 且【有对白】的分镜，
 * 在此单点收口到 generationParams.emphasis（裸 sceneId 字符串数组，按新建分镜 id 关联）
 * ——与转场/音效聚合同模式。旁白（无对白）的 emphasis 标注忽略（花字只上对白）；
 * 上限 MAX_EMPHASIS_SCENES 从宽钳制。全部缺席返回 null（不写空数组污染 generationParams）。
 */
function aggregateSceneEmphasis(
  scenes: unknown[],
  orderToNewSceneId: Map<number, string>
): string[] | null {
  const result: string[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    if (result.length >= MAX_EMPHASIS_SCENES) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = scenes[i] as any;
    const sceneId = orderToNewSceneId.get(i);
    if (!sceneId) continue;
    const hasDialogue =
      typeof raw?.dialogue === "string" && raw.dialogue.trim().length > 0;
    if (raw?.emphasis === true && hasDialogue) {
      result.push(sceneId);
    }
  }
  return result.length > 0 ? result : null;
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
      // 全量命中去重保序：复数 selectedCharacterIds 驱动 UI chips 自动高亮与
      // 多角色参考图合成（≥2 触发）；首个命中兼容单数 selectedCharacterId 锚点
      const matchedCharacterIds: string[] = [];
      for (const characterName of sceneCharacters) {
        const matched = matchCharacterByName(projectCharacters, characterName);
        if (matched && !matchedCharacterIds.includes(matched.id)) {
          matchedCharacterIds.push(matched.id);
        }
      }
      const selectedCharacterId: string | null = matchedCharacterIds[0] ?? null;
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
        selectedCharacterIds: matchedCharacterIds,
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
        // 叙事节拍（批4）：beatType 驱动默认冲击效果与视频动作强度；
        // isClimax 高潮镜标记（出图夸张表情升档、生成侧豁免裁剪）
        beatType:
          scene.beatType === "impact" ||
          scene.beatType === "reveal" ||
          scene.beatType === "emotional"
            ? scene.beatType
            : null,
        isClimax: scene.isClimax === true,
        // 尾帧衔接下一镜：LLM 解析产出（linkNext），映射到 videoLinkNext；
        // 老输出无此字段时布尔化为 false，行为与今日一致（向后兼容）。
        videoLinkNext: Boolean(scene.linkNext),
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

    // 聚合脚本直转携带的分镜间转场（批2）：短剧/一键制片两条路径都经此，
    // 单点收口。有转场时覆盖 transitions（脚本转场即本次重建的权威来源；
    // remap 截断的旧转场按顺序失效，脚本产出的新转场取而代之）。
    const aggregatedTransitions = aggregateSceneTransitions(scenes);
    let nextParams = remappedParams;
    let paramsChanged = changed;
    if (aggregatedTransitions) {
      nextParams = { ...remappedParams, transitions: aggregatedTransitions };
      paramsChanged = true;
    }

    // 聚合解析层音效标注（批1）：同转场，脚本产出即本次重建的权威来源
    const aggregatedSfx = aggregateSceneSfx(scenes, orderToNewSceneId);
    if (aggregatedSfx) {
      nextParams = { ...nextParams, sfx: aggregatedSfx };
      paramsChanged = true;
    }

    // 聚合解析层金句花字标注（批6）：同音效，脚本产出即本次重建的权威来源
    const aggregatedEmphasis = aggregateSceneEmphasis(
      scenes,
      orderToNewSceneId
    );
    if (aggregatedEmphasis) {
      nextParams = { ...nextParams, emphasis: aggregatedEmphasis };
      paramsChanged = true;
    }

    // beatType → 默认冲击效果（批4）：impact 镜默认震屏（+缺音效时补一记重击），
    // reveal 镜默认定格。仅对「该镜没有既存 sceneEffects 条目」的分镜补默认——
    // 重解析桥接来的用户精调优先，不覆盖。
    const beatEffects: SceneEffect[] = [];
    const beatSfx: SceneSfx[] = [];
    const existingEffectIds = new Set(
      (nextParams.sceneEffects ?? []).map((e) => e.sceneId)
    );
    const sfxSceneIds = new Set((aggregatedSfx ?? []).map((s) => s.sceneId));
    scenes.forEach((raw, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const beat = (raw as any)?.beatType;
      const sceneId = orderToNewSceneId.get(i);
      if (!sceneId || existingEffectIds.has(sceneId)) return;
      if (beat === "impact") {
        beatEffects.push({ sceneId, impact: "shake" });
        // 打击镜缺音效时补一记重击（解析层已标 sfx 的不重复）
        if (!sfxSceneIds.has(sceneId)) {
          beatSfx.push({ sceneId, sfxId: "hit-punch", offsetSec: 0 });
        }
      } else if (beat === "reveal") {
        beatEffects.push({ sceneId, impact: "freeze" });
      }
    });
    if (beatEffects.length > 0) {
      nextParams = {
        ...nextParams,
        sceneEffects: [...(nextParams.sceneEffects ?? []), ...beatEffects],
        ...(beatSfx.length > 0
          ? { sfx: [...(nextParams.sfx ?? []), ...beatSfx] }
          : {}),
      };
      paramsChanged = true;
    }

    if (paramsChanged) {
      await prisma.project.update({
        where: { id },
        data: {
          generationParams: nextParams as unknown as Prisma.InputJsonValue,
        },
      });
      log.info(
        `Updated generationParams for project ${id}` +
          (aggregatedTransitions ? " (aggregated scene transitions)" : "") +
          (aggregatedSfx ? ` (aggregated ${aggregatedSfx.length} sfx)` : "") +
          (aggregatedEmphasis
            ? ` (aggregated ${aggregatedEmphasis.length} emphasis)`
            : "")
      );
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
