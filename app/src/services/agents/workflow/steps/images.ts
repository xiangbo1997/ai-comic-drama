/**
 * Step 4：图像生成（Fan-out per scene）
 *
 * 从 `workflow-engine.ts` 平移（纯搬运，无行为变更）：`loadSeriesPalette`、
 * `resolveProjectCharacters`、`executeImageGeneration`。前两者只服务本步，随之下沉。
 */

import { prisma } from "@/lib/prisma";
import { ImageConsistencyAgent } from "../../image-consistency-agent";
import { getThreeViewUrls } from "@/lib/three-views";
import { parseStoryBible } from "@/types/series-bible";
import { extractSeriesPalette } from "@/lib/series";
import { getStylePaletteBaseline } from "@/lib/prompts";
import { emitEvent } from "../../event-bus";
import { log } from "../context";
import { chargeWorkflowItem } from "../credits";
import { updateSceneImage } from "../scene-persistence";
import type {
  WorkflowContext,
  CharacterBible,
  SceneArtifact,
  ImageArtifact,
} from "../../types";
import type {
  SceneCharacterInfo,
  CharacterRole,
} from "@/services/generation/types";

/**
 * 取项目所属系列的统一色板（精简串）。
 *
 * 非系列项目 / 无 colorScript / 查库异常一律返回 undefined —— 色板是出图增强项，
 * 绝不阻断生成。链路：Project.seriesId → Series.storyBible(Json) → parseStoryBible
 * （容错，永不抛错）→ extractSeriesPalette（裸色板事实）。
 */
async function loadSeriesPalette(
  projectId: string
): Promise<string | undefined> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { seriesId: true },
    });
    if (!project?.seriesId) return undefined;
    const series = await prisma.series.findUnique({
      where: { id: project.seriesId },
      select: { storyBible: true },
    });
    if (!series) return undefined;
    return extractSeriesPalette(parseStoryBible(series.storyBible));
  } catch (err) {
    log.warn(
      `[workflow] 加载系列色板失败，按无色板出图`,
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

/**
 * 一次性把项目内所有角色解析为 name → SceneCharacterInfo 的 Map，避免逐场景查库（N+1）。
 * 查全部 referenceAssets（不再只查 isCanonical），在内存中分别解析：
 *   - canonicalImageUrl：优先 isCanonical 参考资产（经 i2i 定妆，最可靠）→ 回退 canonicalImageUrl
 *     字段 → 回退旧 referenceImages[0]（与手动路径 api/generate/image 的回退链一致）。
 *   - referenceImageUrls：三视图（front/side/back）在前 + 定妆图兜底，去重——
 *     与手动路径客户端 collectCharacterRefs 同规则。此前只给 1 张定妆图，
 *     workflow 自动路径的三视图从未进入出图参考，与手动路径质量不对等。
 * role 留空占位，由 ImageConsistencyAgent 按场景出场顺序重定（第一个 = primary）。
 */
async function resolveProjectCharacters(
  projectId: string
): Promise<Map<string, SceneCharacterInfo>> {
  const characters = await prisma.character.findMany({
    where: { projects: { some: { projectId } } },
    include: {
      appearance: true,
      referenceAssets: {
        select: {
          url: true,
          pose: true,
          isCanonical: true,
          qualityScore: true,
          createdAt: true,
        },
      },
    },
  });

  const map = new Map<string, SceneCharacterInfo>();
  for (const c of characters) {
    // 定妆图：isCanonical 资产按 qualityScore desc（null 视为最低）、createdAt asc 取最优
    const canonicalFromAsset = c.referenceAssets
      .filter((a) => a.isCanonical)
      .sort(
        (a, b) =>
          (b.qualityScore ?? -1) - (a.qualityScore ?? -1) ||
          a.createdAt.getTime() - b.createdAt.getTime()
      )[0]?.url;
    const canonicalImageUrl =
      canonicalFromAsset ?? c.canonicalImageUrl ?? c.referenceImages[0];

    // 多角度参考：三视图在前、定妆图兜底、去重
    const referenceImageUrls: string[] = [];
    for (const url of getThreeViewUrls(c.referenceAssets)) {
      if (!referenceImageUrls.includes(url)) referenceImageUrls.push(url);
    }
    if (canonicalImageUrl && !referenceImageUrls.includes(canonicalImageUrl)) {
      referenceImageUrls.push(canonicalImageUrl);
    }

    map.set(c.name, {
      id: c.id,
      name: c.name,
      role: "primary" as CharacterRole, // 占位，Agent 按场景顺序重定
      gender: c.gender,
      age: c.age,
      description: c.description,
      referenceImages: c.referenceImages,
      canonicalImageUrl: canonicalImageUrl ?? undefined,
      // 「真」定妆锚（供 face-validator 作校验基准）：只认真实定妆产物 ——
      // isCanonical 参考资产（三视图 i2i 定妆）或 Character.canonicalImageUrl。
      // ⚠️ 绝不能用上面那个带 `?? c.referenceImages[0]` 回退的合并值：
      // referenceImages[0] 就是喂进出图的参考图本身，拿它当基准会让
      // 「生成图像不像参考图吗」恒为否，闸门形同虚设（见 types.ts 字段注释）。
      // 此前 workflow 完全不填此字段 → 一键出片全程零身份校验
      // （face-validator 走 passthrough("no_true_canonical_anchor")）。
      trueCanonicalImageUrl:
        (canonicalFromAsset ?? c.canonicalImageUrl) || undefined,
      referenceImageUrls:
        referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
      // 用户预设服装（外观编辑器手填/AI 起草）：供场景定妆照换装匹配，
      // 命中且带 imageRef 时直接用用户手挑参考图（与手动路径对等）
      clothingPresets:
        (c.appearance
          ?.clothingPresets as SceneCharacterInfo["clothingPresets"]) ??
        undefined,
      // 带 pose 的参考资产：供朝向感知选图（背影镜取背视图等）。排序与手动路径
      // sortReferenceAssets 同规则（定妆优先→质量分降序→创建早优先），保证同 pose
      // 多张资产时两条出图路径挑到同一张（对等性）。
      referenceAssets:
        c.referenceAssets.length > 0
          ? [...c.referenceAssets]
              .sort(
                (a, b) =>
                  (a.isCanonical === b.isCanonical
                    ? 0
                    : a.isCanonical
                      ? -1
                      : 1) ||
                  (b.qualityScore ?? -1) - (a.qualityScore ?? -1) ||
                  a.createdAt.getTime() - b.createdAt.getTime()
              )
              .map((a) => ({ url: a.url, pose: a.pose }))
          : undefined,
      appearance: c.appearance as SceneCharacterInfo["appearance"],
    });
  }
  return map;
}

/** 场景级并行图像生成 */
export async function executeImageGeneration(
  scenes: SceneArtifact[],
  characterBible: CharacterBible,
  ctx: WorkflowContext
): Promise<void> {
  const imageAgent = new ImageConsistencyAgent();

  emitEvent({
    type: "step:started",
    workflowRunId: ctx.workflowRunId,
    step: "generate_images",
    data: {
      totalScenes: scenes.length,
      message: `开始生成 ${scenes.length} 个场景的图像...`,
    },
    timestamp: new Date(),
  });

  // 批次前一次性解析：项目角色（含 canonicalImageUrl）、分镜 order→DB id 映射、项目画幅。
  // 三者都只查一次，杜绝逐场景查库（N+1）。
  const characterMap = await resolveProjectCharacters(ctx.projectId);
  const dbScenes = await prisma.scene.findMany({
    where: { projectId: ctx.projectId },
    select: { id: true, order: true },
  });
  const sceneIdByOrder = new Map(dbScenes.map((s) => [s.order, s.id]));
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { aspectRatio: true },
  });
  const projectAspectRatio = (project?.aspectRatio ?? "9:16") as
    | "1:1"
    | "9:16"
    | "16:9";
  // 负向提示词：服务端只拿得到用户自定义部分（预设逻辑在客户端），
  // 与手动路径「透传客户端 negativePrompt」语义一致。
  const customNegative = ctx.config.generationParams?.customNegative;

  // 色彩设计（color script）：批次前一次性取系列统一色板（非系列 / 无色板为
  // undefined）。透传给出图 Agent，激活「Observer 色调一致性门禁」，让整部剧色调
  // 统一（单镜色彩只在主色板内局部偏移）。查库失败不阻断出图——色板是增强项。
  // 无系列色板时，退回画风包色彩基线（画风调性 + 情绪色盘）作为色调门禁参考，
  // 让 Observer 在画风调性内判色调一致性，而非无基线自由判。legacy 风格返回空 → undefined。
  const seriesPalette =
    (await loadSeriesPalette(ctx.projectId)) ||
    getStylePaletteBaseline(ctx.config.style) ||
    undefined;

  // 为单个场景组装 Agent 输入：注入 DB 解析出的角色 + sceneDbId + 画幅 + 负向词 + 色板
  const buildInput = (scene: SceneArtifact) => {
    const resolvedCharacters = (scene.characters ?? [])
      .map((name) => characterMap.get(name))
      .filter((c): c is SceneCharacterInfo => Boolean(c));
    return {
      scene,
      characterBible,
      resolvedCharacters,
      sceneDbId: sceneIdByOrder.get(scene.order),
      aspectRatio: projectAspectRatio,
      negativePrompt: customNegative,
      seriesPalette,
    };
  };

  // 并发控制：最多 3 个场景同时生成
  const concurrency = 3;
  const results: ImageArtifact[] = [];

  // 累计图像失败数：此前 rejected / success===false 分支完全静默——不 log、
  // 不 emit，用户看到 workflow「完成」但成片缺镜头且日志无痕（a7 P2-10）。
  let imageFailures = 0;

  for (let i = 0; i < scenes.length; i += concurrency) {
    const batch = scenes.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((scene) => imageAgent.run(buildInput(scene), ctx))
    );

    for (const result of batchResults) {
      if (
        result.status === "fulfilled" &&
        result.value.success &&
        result.value.data
      ) {
        results.push(result.value.data);
        // 更新场景图像到数据库
        const sceneId = await updateSceneImage(
          ctx.projectId,
          result.value.data
        );
        // 扣费（与手动路径一致：带参考图 3，否则 1）
        if (sceneId) {
          await chargeWorkflowItem(ctx, {
            sceneId,
            kind: "image",
            amount: result.value.data.strategy === "reference_edit" ? 3 : 1,
            note: `场景 ${result.value.data.sceneId} 图像生成（策略 ${result.value.data.strategy}）`,
          });
        }
      } else {
        // 失败分支不再静默：记日志（含原因），让缺镜头可追溯
        imageFailures++;
        const reason =
          result.status === "rejected"
            ? result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
            : (result.value.error ?? "生成失败");
        log.warn(`Workflow 图像生成失败，该分镜将无图`, { reason });
      }
    }

    emitEvent({
      type: "progress:update",
      workflowRunId: ctx.workflowRunId,
      step: "generate_images",
      data: {
        completed: Math.min(i + concurrency, scenes.length),
        total: scenes.length,
      },
      timestamp: new Date(),
    });
  }

  // 阶段结束：有失败则 emit 一次汇总，让前端能提示「X/Y 成功，Z 张失败」，
  // 不把部分失败伪装成全部完成。
  if (imageFailures > 0) {
    log.warn(
      `Workflow 图像阶段完成：${results.length}/${scenes.length} 成功，${imageFailures} 张失败`
    );
    emitEvent({
      type: "step:completed",
      workflowRunId: ctx.workflowRunId,
      step: "generate_images",
      data: {
        message: `图像生成完成：${results.length} 成功，${imageFailures} 失败（失败分镜将无图，可在编辑器单独重试）`,
        succeeded: results.length,
        failed: imageFailures,
        total: scenes.length,
      },
      timestamp: new Date(),
    });
  }
}
