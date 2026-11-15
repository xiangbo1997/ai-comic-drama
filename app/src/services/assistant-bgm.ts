import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BGM_TRACKS } from "@/lib/bgm-library";
import { majorityBgmCategory } from "@/lib/emotion-bgm";
import { normalizeGenerationParams } from "@/lib/generation-params-normalize";
import {
  DEFAULT_BACKGROUND_MUSIC,
  type BackgroundMusic,
} from "@/types/export-style";
import { AssistantToolError } from "@/lib/assistant-errors";
import type { AssistantIntent } from "@/lib/assistant-intent";
import { getAvailableBgmTracks } from "@/services/bgm-assets";

interface BgmScope {
  userId: string;
  projectId?: string;
  seriesId?: string | null;
}
export const AssistantBgmOptionsZ = z
  .object({
    mode: z.enum(["auto", "track", "adjust", "on", "off"]),
    trackId: z.string().min(1).max(64).optional(),
    volume: z.number().min(0).max(1).optional(),
    ducking: z.boolean().optional(),
    loop: z.boolean().optional(),
    fadeIn: z.number().min(0).max(10).optional(),
    fadeOut: z.number().min(0).max(10).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.mode === "track"
        ? !BGM_TRACKS.some((track) => track.id === value.trackId)
        : value.trackId !== undefined
    )
      ctx.addIssue({
        code: "custom",
        message: "请使用曲库中的真实曲目编号；仅track模式指定trackId",
      });
    if (value.mode === "adjust" && Object.keys(value).length === 1)
      ctx.addIssue({ code: "custom", message: "请提供需要调整的配乐设置" });
    if (value.mode === "off" && Object.keys(value).length > 1)
      ctx.addIssue({
        code: "custom",
        message: "关闭配乐时不能同时修改原有设置",
      });
  });

function owned(scope: BgmScope) {
  if (!scope.projectId)
    throw new AssistantToolError("请从具体作品或当前集打开助手后配置配乐");
  return {
    id: scope.projectId,
    userId: scope.userId,
    seriesId: scope.seriesId ?? null,
  };
}

export async function readAssistantBgm(scope: BgmScope) {
  const project = await prisma.project.findFirst({
    where: owned(scope),
    select: { generationParams: true },
  });
  if (!project) throw new AssistantToolError("当前作品不存在或归属已变化");
  const params = normalizeGenerationParams(project.generationParams);
  const tracks = await getAvailableBgmTracks();
  return {
    current: params?.backgroundMusic ?? DEFAULT_BACKGROUND_MUSIC,
    autoSegments: params?.autoBgmSegments !== false,
    tracks,
    available: tracks.length > 0,
    note: tracks.length
      ? "仅列出服务器上可用的内置曲目"
      : "内置曲库文件缺失或不可用，请管理员填充曲库并重新构建部署",
    cost: 0,
  };
}

export async function configureAssistantBgm(
  scope: BgmScope,
  raw: unknown,
  intent: AssistantIntent,
  signal?: AbortSignal
) {
  const options = AssistantBgmOptionsZ.parse(raw);
  const where = owned(scope);
  if (!intent.allowBgmWrite)
    throw new AssistantToolError(
      "本轮未授权修改配乐，请先明确要求添加或调整背景音乐"
    );
  if (options.mode === "off" && !intent.allowBgmDisable)
    throw new AssistantToolError("关闭配乐需要用户明确要求");
  signal?.throwIfAborted();
  // 文件I/O放在事务外，避免延长项目配置锁的持有时间。
  const available = options.mode === "off" ? [] : await getAvailableBgmTracks();
  return prisma.$transaction(async (tx) => {
    // 与编辑器配置保存共用锁，锁内读取最新JSON，只改音乐字段，保留其他设置。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-scenes:${scope.projectId}`}, 0))`;
    const project = await tx.project.findFirst({
      where,
      select: {
        generationParams: true,
        updatedAt: true,
        scenes: {
          orderBy: { order: "asc" },
          select: { emotion: true },
          take: 500,
        },
      },
    });
    if (!project) throw new AssistantToolError("当前作品不存在或归属已变化");
    const current = normalizeGenerationParams(project.generationParams);
    const existing = current?.backgroundMusic as BackgroundMusic | undefined;
    const replacing = options.mode === "auto" || options.mode === "track";
    if (replacing && existing?.url && !intent.allowBgmReplace)
      throw new AssistantToolError(
        "当前已有配乐，已保留；请明确要求替换或仅调整音量"
      );
    if ((options.mode === "adjust" || options.mode === "on") && !existing?.url)
      throw new AssistantToolError("当前没有配乐，请先添加一首背景音乐");
    const { mode, trackId, ...adjustments } = options;
    const track = replacing
      ? mode === "track"
        ? available.find((item) => item.id === trackId)
        : (available.find(
            (item) =>
              item.category ===
              majorityBgmCategory(project.scenes.map((scene) => scene.emotion))
          ) ?? available[0])
      : undefined;
    if (replacing && !track)
      throw new AssistantToolError(
        "所选内置曲库文件不可用，请管理员填充曲库并重新构建部署"
      );
    if (
      !replacing &&
      mode !== "off" &&
      existing?.url?.startsWith("/bgm/") &&
      !available.some((item) => item.url === existing.url)
    )
      throw new AssistantToolError(
        "原有内置配乐文件不可用，请管理员修复曲库后重试"
      );
    const backgroundMusic = {
      ...DEFAULT_BACKGROUND_MUSIC,
      ...existing,
      ...adjustments,
      ...(track ? { enabled: true, trackId: track.id, url: track.url } : {}),
      ...(mode === "off" ? { enabled: false } : {}),
      ...(mode === "on" ? { enabled: true } : {}),
    };
    const previous =
      project.generationParams &&
      typeof project.generationParams === "object" &&
      !Array.isArray(project.generationParams)
        ? project.generationParams
        : {};
    const generationParams = {
      ...previous,
      backgroundMusic,
      ...(replacing ? { autoBgmSegments: false } : {}),
    };
    signal?.throwIfAborted();
    const saved = await tx.project.updateMany({
      where: { ...where, updatedAt: project.updatedAt },
      data: { generationParams: generationParams as Prisma.InputJsonValue },
    });
    if (saved.count !== 1)
      throw new AssistantToolError("项目设置已更新或归属变化，请刷新后重试");
    return {
      success: true,
      cost: 0,
      backgroundMusic,
      needsExport: true,
      summary:
        mode === "off"
          ? "已关闭当前集背景音乐，原曲设置已保留"
          : `已保存当前集背景音乐${track ? `《${track.title}》` : "设置"}（免费曲库/配置，不消耗生成积分）`,
      note: "编辑器预览与下一次导出会使用新设置；已导出的视频文件未改写，需要重新导出。未生成或重做图片、视频。",
    };
  });
}
