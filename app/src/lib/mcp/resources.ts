/**
 * MCP Resource 注册（只读）。
 *
 * 全部返回**纯文本事实**，不含任何媒体 URL——理由见 lib/mcp/serialize.ts 顶部注释：
 * 给模型一串它打不开的链接，只会诱导它编造对画面的判断。「有没有出图」用
 * imageStatus/videoStatus/audioStatus 表达。
 */

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import {
  STORYBOARD_PAGE_SIZE,
  toResourceJson,
  toSceneTextView,
} from "@/lib/mcp/serialize";
import { parseStoryBible } from "@/types/series-bible";

/** 注册全部只读资源 */
export function registerResources(server: McpServer, userId: string): void {
  // ------------------------------------------------------------- 项目列表
  server.registerResource(
    "projects",
    "comic://projects",
    {
      title: "我的项目",
      description: "当前账号下的全部漫剧项目（含系列归属与分镜数）",
      mimeType: "application/json",
    },
    async (uri) => {
      const projects = await prisma.project.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          style: true,
          aspectRatio: true,
          seriesId: true,
          episodeNumber: true,
          updatedAt: true,
          _count: { select: { scenes: true } },
        },
      });

      return toResourceJson(
        uri.href,
        projects.map((p) => ({
          projectId: p.id,
          title: p.title,
          description: p.description,
          status: p.status,
          style: p.style,
          aspectRatio: p.aspectRatio,
          seriesId: p.seriesId,
          episodeNumber: p.episodeNumber,
          sceneCount: p._count.scenes,
          updatedAt: p.updatedAt.toISOString(),
        }))
      );
    }
  );

  // ------------------------------------------------------------- 项目详情
  server.registerResource(
    "project-detail",
    new ResourceTemplate("comic://project/{projectId}", { list: undefined }),
    {
      title: "项目详情",
      description: "单个项目的设定、生成参数与系列归属",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId);
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          style: true,
          aspectRatio: true,
          inputText: true,
          generationParams: true,
          seriesId: true,
          episodeNumber: true,
          createdAt: true,
          updatedAt: true,
          series: { select: { id: true, title: true, genre: true } },
          _count: { select: { scenes: true } },
        },
      });
      if (!project) return notFound(uri.href, "项目不存在或无权访问");

      return toResourceJson(uri.href, {
        projectId: project.id,
        title: project.title,
        description: project.description,
        status: project.status,
        style: project.style,
        aspectRatio: project.aspectRatio,
        inputText: project.inputText,
        generationParams: project.generationParams,
        sceneCount: project._count.scenes,
        series: project.series
          ? {
              seriesId: project.series.id,
              title: project.series.title,
              genre: project.series.genre,
              episodeNumber: project.episodeNumber,
            }
          : null,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      });
    }
  );

  // ------------------------------------------------------------- 分镜表
  server.registerResource(
    "project-storyboard",
    new ResourceTemplate("comic://project/{projectId}/storyboard", {
      list: undefined,
    }),
    {
      title: "分镜表",
      description:
        "项目分镜的纯文本视图（景别/画面/对白/旁白/时长/生成状态）。" +
        "长剧集分页：URI 追加 ?offset=40 读取后续分镜。",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId);
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
      });
      if (!project) return notFound(uri.href, "项目不存在或无权访问");

      const offset = parseOffset(uri);
      const [total, scenes] = await Promise.all([
        prisma.scene.count({ where: { projectId } }),
        prisma.scene.findMany({
          where: { projectId },
          orderBy: { order: "asc" },
          skip: offset,
          take: STORYBOARD_PAGE_SIZE,
          select: {
            id: true,
            order: true,
            shotType: true,
            description: true,
            dialogue: true,
            narration: true,
            emotion: true,
            duration: true,
            cameraMovement: true,
            imageStatus: true,
            videoStatus: true,
            audioStatus: true,
          },
        }),
      ]);

      const nextOffset = offset + scenes.length;
      return toResourceJson(uri.href, {
        projectId,
        total,
        offset,
        returned: scenes.length,
        nextOffset: nextOffset < total ? nextOffset : null,
        scenes: scenes.map(toSceneTextView),
      });
    }
  );

  // ------------------------------------------------------------- 角色设定
  server.registerResource(
    "project-characters",
    new ResourceTemplate("comic://project/{projectId}/characters", {
      list: undefined,
    }),
    {
      title: "角色设定",
      description: "项目关联角色的文字设定（姓名/性别/年龄/人设/外貌）",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId);
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
      });
      if (!project) return notFound(uri.href, "项目不存在或无权访问");

      const links = await prisma.projectCharacter.findMany({
        where: { projectId },
        select: {
          character: {
            select: {
              id: true,
              name: true,
              gender: true,
              age: true,
              description: true,
              appearance: {
                select: {
                  hairStyle: true,
                  hairColor: true,
                  faceShape: true,
                  eyeColor: true,
                  bodyType: true,
                  height: true,
                  skinTone: true,
                  clothingPresets: true,
                  accessories: true,
                  freeText: true,
                  // 美术工业一致性 6 项（外部 MCP 消费方同样需要完整角色设定）
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
      });

      return toResourceJson(uri.href, {
        projectId,
        characters: links.map((l) => ({
          characterId: l.character.id,
          name: l.character.name,
          gender: l.character.gender,
          age: l.character.age,
          description: l.character.description,
          appearance: l.character.appearance,
        })),
      });
    }
  );

  // ------------------------------------------------------------- 制作进度
  server.registerResource(
    "project-progress",
    new ResourceTemplate("comic://project/{projectId}/progress", {
      list: undefined,
    }),
    {
      title: "制作进度",
      description: "各环节完成度统计：分镜数、已出图/已出视频/已配音数量",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId);
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true, title: true, status: true },
      });
      if (!project) return notFound(uri.href, "项目不存在或无权访问");

      const [total, scripts, imageDone, videoDone, audioDone, speakable] =
        await Promise.all([
          prisma.scene.count({ where: { projectId } }),
          prisma.shortDramaScript.count({ where: { projectId } }),
          prisma.scene.count({
            where: { projectId, imageStatus: "COMPLETED" },
          }),
          prisma.scene.count({
            where: { projectId, videoStatus: "COMPLETED" },
          }),
          prisma.scene.count({
            where: { projectId, audioStatus: "COMPLETED" },
          }),
          prisma.scene.count({
            where: {
              projectId,
              OR: [{ dialogue: { not: null } }, { narration: { not: null } }],
            },
          }),
        ]);

      return toResourceJson(uri.href, {
        projectId,
        title: project.title,
        status: project.status,
        scriptCount: scripts,
        sceneCount: total,
        imageCompleted: imageDone,
        videoCompleted: videoDone,
        audioCompleted: audioDone,
        speakableSceneCount: speakable,
        nextStep: suggestNextStep({
          scripts,
          total,
          imageDone,
          videoDone,
          audioDone,
          speakable,
        }),
      });
    }
  );

  // ------------------------------------------------------------- 系列信息
  server.registerResource(
    "series-detail",
    new ResourceTemplate("comic://series/{seriesId}", { list: undefined }),
    {
      title: "系列信息",
      description: "系列设定、剧集列表与故事圣经摘要（跨集记忆）",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const seriesId = String(variables.seriesId);
      const series = await prisma.series.findFirst({
        where: { id: seriesId, userId },
        select: {
          id: true,
          title: true,
          description: true,
          worldview: true,
          protagonist: true,
          genre: true,
          style: true,
          aspectRatio: true,
          storyBible: true,
          projects: {
            orderBy: { episodeNumber: "asc" },
            select: {
              id: true,
              title: true,
              episodeNumber: true,
              status: true,
              _count: { select: { scenes: true } },
            },
          },
        },
      });
      if (!series) return notFound(uri.href, "系列不存在或无权访问");

      const bible = parseStoryBible(series.storyBible);

      return toResourceJson(uri.href, {
        seriesId: series.id,
        title: series.title,
        description: series.description,
        worldview: series.worldview,
        protagonist: series.protagonist,
        genre: series.genre,
        style: series.style,
        aspectRatio: series.aspectRatio,
        episodes: series.projects.map((p) => ({
          projectId: p.id,
          title: p.title,
          episodeNumber: p.episodeNumber,
          status: p.status,
          sceneCount: p._count.scenes,
        })),
        storyBible: bible,
      });
    }
  );
}

/** 资源缺失时返回一条说明文本，而不是抛错——让模型知道该换个 id 而非重试 */
function notFound(uri: string, message: string) {
  return {
    contents: [{ uri, mimeType: "text/plain" as const, text: message }],
  };
}

/** 从 URI 查询串读取分页 offset */
function parseOffset(uri: URL): number {
  const raw = uri.searchParams.get("offset");
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** 依据完成度给出下一步建议，帮模型把用户导向正确环节 */
function suggestNextStep(s: {
  scripts: number;
  total: number;
  imageDone: number;
  videoDone: number;
  audioDone: number;
  speakable: number;
}): string {
  if (s.scripts === 0) return "尚无脚本，先用 generate_drama_script 生成剧本";
  if (s.total === 0) return "已有脚本但还没分镜，用 script_to_storyboard 落库";
  if (s.imageDone < s.total) return "分镜已就绪，到网页编辑器出图";
  if (s.audioDone < s.speakable) return "画面已完成，到网页编辑器配音";
  if (s.videoDone < s.total) return "可在网页编辑器生成视频";
  return "各环节已就绪，可到网页编辑器导出成片";
}
