import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { deleteFile } from "@/services/storage";

import { createLogger } from "@/lib/logger";
import { normalizeGenerationParams } from "@/lib/generation-params-normalize";
import { resolveEpisodeEndingHook } from "@/lib/series";
import { parseStoryBible, isBibleEmpty } from "@/types/series-bible";
const log = createLogger("api:projects:[id]");

/**
 * 删除项目后清理其分镜媒体文件（R2 或本地盘，由 storage.deleteFile 门面分派）。
 * 后台执行，失败仅记日志（孤儿文件可后续批量清理）。
 */
async function cleanupProjectMedia(
  projectId: string,
  urls: string[]
): Promise<void> {
  const results = await Promise.allSettled(urls.map((u) => deleteFile(u)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    log.warn(
      `项目 ${projectId} 删除后清理存储：${urls.length} 个文件中 ${failed} 个失败（孤儿）`
    );
  } else {
    log.info(`项目 ${projectId} 删除后清理 ${urls.length} 个媒体文件完成`);
  }
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 分镜僵尸状态惰性回收：把超时仍卡在 PROCESSING 的图/视/音状态标 FAILED。
 *
 * 背景：所有生成都同步跑在 web 请求进程里（无独立 worker），进程 rolling
 * update / OOM / 崩溃时，在途分镜的 *Status 会永久停在 PROCESSING，编辑器
 * 读到就无限转圈（reliability P0）。这里在读取项目时就地回收，复用 export
 * 那套 10 分钟阈值。以 updatedAt 作为陈旧锚点（置 PROCESSING 即更新 updatedAt）。
 *
 * 返回是否发生回收，供调用方决定是否需要重读。
 */
async function reclaimZombieScenes(projectId: string): Promise<boolean> {
  const ZOMBIE_TIMEOUT_MS = 10 * 60 * 1000;
  const cutoff = new Date(Date.now() - ZOMBIE_TIMEOUT_MS);

  // 先廉价 count 判断有无超时 PROCESSING 分镜；绝大多数 GET（项目无在途
  // 生成）到此即返回，不开写事务（a3 审计 P1-4：GET 是高频轮询端点，
  // 原每次无条件跑 3 条 updateMany 写事务，与并发生成的行锁竞争）。
  const zombieCount = await prisma.scene.count({
    where: {
      projectId,
      updatedAt: { lt: cutoff },
      OR: [
        { imageStatus: "PROCESSING" },
        { videoStatus: "PROCESSING" },
        { audioStatus: "PROCESSING" },
      ],
    },
  });
  if (zombieCount === 0) return false;

  const [img, vid, aud] = await prisma.$transaction([
    prisma.scene.updateMany({
      where: {
        projectId,
        imageStatus: "PROCESSING",
        updatedAt: { lt: cutoff },
      },
      data: { imageStatus: "FAILED" },
    }),
    prisma.scene.updateMany({
      where: {
        projectId,
        videoStatus: "PROCESSING",
        updatedAt: { lt: cutoff },
      },
      data: { videoStatus: "FAILED" },
    }),
    prisma.scene.updateMany({
      where: {
        projectId,
        audioStatus: "PROCESSING",
        updatedAt: { lt: cutoff },
      },
      data: { audioStatus: "FAILED" },
    }),
  ]);
  return img.count + vid.count + aud.count > 0;
}

// 获取单个项目详情
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 归属校验放在回收之前：先确认项目属于当前用户，避免对他人项目做写操作
    const owned = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    await reclaimZombieScenes(id);

    const project = await prisma.project.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        // 系列上下文：编辑器头部徽标 + 上下集导航 + 短剧脚本世界观预填。
        // episodes 只取轻量标识字段，量级 = 系列集数（十几条），无膨胀风险
        series: {
          select: {
            id: true,
            title: true,
            genre: true,
            worldview: true,
            protagonist: true,
            storyBible: true,
            projects: {
              orderBy: { episodeNumber: "asc" },
              select: { id: true, title: true, episodeNumber: true },
            },
          },
        },
        scenes: {
          orderBy: { order: "asc" },
          include: {
            // 窄 select：editor 只读 character 的这几个字段，原 include 全量行
            // 拉了 @db.Text description + appearance JSON + 时间戳等，payload
            // 随台词长度线性膨胀（a3 审计 P1-3）。sceneCharacters.character
            // 前端未直接消费展示，仅取轻量标识字段。
            sceneCharacters: {
              include: {
                character: {
                  select: { id: true, name: true },
                },
              },
            },
            // selectedCharacter 必须与下方 characters.character 那份【字段对齐】：
            // 单角色分镜（占绝大多数）走本分支，客户端 collectCharacterRefs /
            // deriveIdentityPrompt 要的 canonicalImageUrl（定妆锚）、referenceAssets
            // （三视图）、description（身份描述）此前全部缺失，于是单角色分镜既拿不到
            // 定妆锚也拿不到三视图，出图退化成纯文生图 → 人物跨镜漂移。
            // 新增字段均为轻量标识/URL，不含 @db.Text 大字段以外的冗余。
            selectedCharacter: {
              select: {
                id: true,
                name: true,
                description: true,
                gender: true,
                age: true,
                referenceImages: true,
                canonicalImageUrl: true,
                referenceAssets: {
                  select: { url: true, pose: true, createdAt: true },
                },
                appearance: {
                  select: {
                    hairStyle: true,
                    hairColor: true,
                    faceShape: true,
                    eyeColor: true,
                    bodyType: true,
                    height: true,
                    skinTone: true,
                    accessories: true,
                    freeText: true,
                    // 美术工业一致性 6 项：漏 select 会让冻结外貌文本在本路径上缺项
                    defaultOutfit: true,
                    outfitDetails: true,
                    headToBodyRatio: true,
                    hairParting: true,
                    eyeHighlight: true,
                    asymmetry: true,
                  },
                },
              },
            },
          },
        },
        // characters.character：编辑器 derivePromptInputs 消费 id/name/description/
        // referenceImages + referenceAssets(url/pose/createdAt，供三视图锁形象)，
        // deriveIdentityPrompt 另需 gender/age/appearance 拼身份前缀。
        // ⚠️ 字段集必须与上面 selectedCharacter 那份保持一致（单/多角色分镜走不同
        // 分支，任一边漏字段都会让该类分镜静默丢锚），并与 types/scene.ts 的
        // Scene.selectedCharacter 内联类型同步——漏声明不会被类型系统发现。
        characters: {
          include: {
            character: {
              select: {
                id: true,
                name: true,
                description: true,
                gender: true,
                age: true,
                referenceImages: true,
                canonicalImageUrl: true,
                voiceId: true,
                referenceAssets: {
                  select: { url: true, pose: true, createdAt: true },
                },
                // 结构化外貌：视频端 deriveIdentityPrompt 据此拼身份前缀。
                // 此前只有 description，为空就完全没有身份约束、I2V 一动人物就漂。
                // 窄 select（不含 clothingPresets 等大字段），仅取外貌描述用得上的项。
                appearance: {
                  select: {
                    hairStyle: true,
                    hairColor: true,
                    faceShape: true,
                    eyeColor: true,
                    bodyType: true,
                    height: true,
                    skinTone: true,
                    accessories: true,
                    freeText: true,
                    // 美术工业一致性 6 项：漏 select 会让冻结外貌文本在本路径上缺项
                    defaultOutfit: true,
                    outfitDetails: true,
                    headToBodyRatio: true,
                    hairParting: true,
                    eyeHighlight: true,
                    asymmetry: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // series.projects → series.episodes：对齐前端 ProjectSeriesInfo 契约。
    // 故事圣经只回传编辑器需要的「摘要」（主题/未解决伏笔数/上一集钩子），
    // 不回传完整圣经（那是史官/手动编辑端的数据，前端展示用不到全量）。
    const { series, ...rest } = project;
    let bibleSummary: {
      theme: string | null;
      openThreads: number;
      episodeCount: number;
      lastEpisodeHook: string | null;
    } | null = null;
    // 本集结尾钩子：预览端片尾钩子卡的文案来源，与导出端共用
    // resolveEpisodeEndingHook（否则预览显示兜底通用文案、导出是真钩子，
    // 违反「预览必须反映导出效果」）。与 bibleSummary 的 isBibleEmpty 门禁
    // 无关——只要圣经里有本集条目就回传。
    let episodeEndingHook: string | null = null;
    if (series) {
      const bible = parseStoryBible(series.storyBible);
      episodeEndingHook = resolveEpisodeEndingHook(bible, rest.episodeNumber);
      if (!isBibleEmpty(bible)) {
        const sortedEps = [...bible.episodes].sort(
          (a, b) => a.episodeNumber - b.episodeNumber
        );
        const lastEp = sortedEps[sortedEps.length - 1];
        bibleSummary = {
          theme: bible.theme ?? null,
          openThreads: bible.threads.filter((t) => t.status === "open").length,
          episodeCount: bible.episodes.length,
          lastEpisodeHook: lastEp?.endingHook || null,
        };
      }
    }
    return NextResponse.json({
      ...rest,
      series: series
        ? {
            id: series.id,
            title: series.title,
            genre: series.genre,
            worldview: series.worldview,
            protagonist: series.protagonist,
            episodes: series.projects,
            bibleSummary,
            episodeEndingHook,
          }
        : null,
    });
  } catch (error) {
    log.error("Get project error:", error);
    return NextResponse.json(
      { error: "Failed to get project" },
      { status: 500 }
    );
  }
}

// 更新项目
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      title,
      description,
      status,
      style,
      aspectRatio,
      inputText,
      generationParams,
      seriesId,
      episodeNumber,
    } = body;

    // 验证项目归属
    const existing = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 系列归属变更：目标系列必须存在且属于当前用户；null = 移出系列
    if (seriesId !== undefined && seriesId !== null) {
      if (typeof seriesId !== "string") {
        return NextResponse.json({ error: "seriesId 无效" }, { status: 400 });
      }
      const targetSeries = await prisma.series.findFirst({
        where: { id: seriesId, userId: session.user.id },
        select: { id: true },
      });
      if (!targetSeries) {
        return NextResponse.json({ error: "系列不存在" }, { status: 404 });
      }
    }
    const normalizedEpisodeNumber =
      episodeNumber === null
        ? null
        : typeof episodeNumber === "number" &&
            Number.isInteger(episodeNumber) &&
            episodeNumber >= 1 &&
            episodeNumber <= 9999
          ? episodeNumber
          : undefined;

    // 校验 generationParams：只接受已知字段 + 合理范围
    const normalizedGenParams =
      generationParams !== undefined
        ? normalizeGenerationParams(generationParams)
        : undefined;

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(style !== undefined && { style }),
        ...(aspectRatio !== undefined && { aspectRatio }),
        ...(inputText !== undefined && { inputText }),
        ...(normalizedGenParams !== undefined && {
          generationParams: normalizedGenParams as Prisma.InputJsonValue,
        }),
        // 移出系列时连带清空集数，避免"无系列却有第N集"的脏数据
        ...(seriesId !== undefined && {
          seriesId,
          ...(seriesId === null && { episodeNumber: null }),
        }),
        ...(normalizedEpisodeNumber !== undefined &&
          seriesId !== null && { episodeNumber: normalizedEpisodeNumber }),
      },
    });

    return NextResponse.json(project);
  } catch (error) {
    log.error("Update project error:", error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}

// 删除项目
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证项目归属
    const existing = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 删库前收集本项目所有分镜的媒体 URL，用于删库后清理存储。
    // 只清分镜级产物（图/视/音）——角色参考资产是跨项目共享资源（N:N），
    // 不在此删除，避免误删其它项目仍引用的角色定妆图。
    const scenes = await prisma.scene.findMany({
      where: { projectId: id },
      select: { imageUrl: true, videoUrl: true, audioUrl: true },
    });
    const mediaUrls = scenes
      .flatMap((s) => [s.imageUrl, s.videoUrl, s.audioUrl])
      .filter((u): u is string => Boolean(u));

    // 项目专属封面（确定性合成产物）也是本项目独有资产，无跨项目共享，
    // 随项目一并清理（漏掉它会留下永久存储孤儿）。
    if (existing.coverImageUrl) {
      mediaUrls.push(existing.coverImageUrl);
    }

    // GenerationTask.projectId 是无外键的 String?（不级联），删项目后 task
    // 行会残留、且其 output 里的中间产物 URL（重试图、三视图等，不在 scene
    // 三 URL 里）成永久存储孤儿（a1 P2-2）。这里一并收集并删除。
    const tasks = await prisma.generationTask.findMany({
      where: { projectId: id },
      select: { output: true },
    });
    for (const t of tasks) {
      const out = t.output as {
        imageUrl?: string;
        videoUrl?: string;
        audioUrl?: string;
      } | null;
      for (const u of [out?.imageUrl, out?.videoUrl, out?.audioUrl]) {
        if (u && typeof u === "string") mediaUrls.push(u);
      }
    }

    // 删项目 + 清项目名下 GenerationTask（无外键不会随 project.delete 级联）
    await prisma.$transaction([
      prisma.generationTask.deleteMany({ where: { projectId: id } }),
      prisma.project.delete({ where: { id } }),
    ]);

    // 存储清理：fire-and-forget，不阻塞响应；失败仅记日志（成孤儿文件，
    // 可后续批量清理），优于让用户等几十个文件逐个删完。去重后清理。
    const uniqueUrls = [...new Set(mediaUrls)];
    if (uniqueUrls.length > 0) {
      void cleanupProjectMedia(id, uniqueUrls);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete project error:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    );
  }
}
