/**
 * MCP 工具注册（剧本工作台）。
 *
 * 边界：**只做文本环节**——世界观起草、建项目、脚本生成、脚本转分镜、角色花名册。
 * 出图/出视频/配音/导出一律不做 tool：那些环节要看画面才能判断好坏，模型在对话里
 * 看不到成片，越俎代庖只会烧积分产出用户不想要的东西。视觉环节交回 Web UI，
 * 每个工具都返回 editorUrl 作为交接点。
 *
 * 所有工具零扣费（与 Web 端 assist/* 和 drama-script 的既定策略一致）。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserLLMConfig } from "@/lib/ai-config";
import { checkTextSafety } from "@/lib/content-safety";
import { runStructuredDraft } from "@/services/assist-draft";
import { generateDramaScript } from "@/services/drama-script";
import {
  derivePreviousEpisodeRecap,
  readStoredGenre,
} from "@/services/drama-script-context";
import { rebuildProjectScenes } from "@/services/scene-rebuild";
import { dramaScriptToScenes, scriptToInputText } from "@/lib/drama-to-scenes";
import {
  WORLDVIEW_DRAFT_SYSTEM,
  buildWorldviewDraftPrompt,
  CHARACTER_ROSTER_SYSTEM,
  MAX_ROSTER_CHARACTERS,
  buildCharacterRosterPrompt,
  filterRosterByNames,
} from "@/lib/prompts";
import { FULL_STYLE_PACK_OPTIONS } from "@/lib/prompts/style-packs";
import { checkMcpRateLimit, mcpRateLimitMessage } from "@/lib/mcp/rate-limit";
import { editorUrl, resolveBaseUrl } from "@/lib/mcp/urls";
import type {
  DramaScriptArtifact,
  DramaScriptInput,
  StoryboardTableArtifact,
} from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("mcp:tools");

/** 每次工具调用的运行上下文（由 route handler 注入） */
export interface McpToolContext {
  userId: string;
  request: NextRequest;
}

/** 只暴露完整画风包：legacy 包缺色彩系统与角色规则，不该让模型选 */
const STYLE_VALUES = FULL_STYLE_PACK_OPTIONS.map((o) => o.value) as [
  string,
  ...string[],
];

const STYLE_DESCRIPTION = `画风包。可选：${FULL_STYLE_PACK_OPTIONS.map(
  (o) => `${o.value}（${o.label}：${o.description}）`
).join("；")}。省略则沿用项目已有画风。`;

/** 结构化返回：既给人看的文本，也给模型用的结构体 */
function ok(payload: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
    structuredContent: payload,
  };
}

/** 工具级错误：用 isError 而非抛异常，让模型能读到原因并自行纠正 */
function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** 校验项目归属；返回项目或 null */
async function findOwnedProject(userId: string, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: {
      id: true,
      title: true,
      style: true,
      aspectRatio: true,
      seriesId: true,
      episodeNumber: true,
      generationParams: true,
    },
  });
}

/**
 * 注册全部工具。
 *
 * @param server  每请求新建的 McpServer 实例
 * @param ctx     当前请求的用户与原始请求（限流要用）
 */
export function registerTools(server: McpServer, ctx: McpToolContext): void {
  const base = resolveBaseUrl(ctx.request);

  // 统一的限流前置：超限直接把「还要等多久」告诉模型
  const guard = async (
    tier: "mcpDefault" | "mcpLlm",
    toolName: string
  ): Promise<string | null> => {
    const rl = await checkMcpRateLimit(ctx.request, tier, toolName, ctx.userId);
    return rl.success ? null : mcpRateLimitMessage(rl);
  };

  // ---------------------------------------------------------------- 世界观起草
  server.registerTool(
    "draft_worldview",
    {
      title: "起草世界观",
      description:
        "把一句话想法扩写成完整世界观、主角设定、题材与片名。这是创作短剧的第一步；" +
        "拿到结果后可让用户确认或调整，再用 create_project + generate_drama_script 落地。",
      inputSchema: z.object({
        idea: z.string().trim().min(1).describe("一句话故事想法"),
        genre: z
          .string()
          .trim()
          .optional()
          .describe("题材倾向，如「都市甜宠」「玄幻复仇」；留空由 AI 判断"),
        seriesContext: z
          .string()
          .trim()
          .optional()
          .describe("若属于某个已有系列，填该系列的背景，便于风格统一"),
      }),
      outputSchema: z.object({
        worldview: z.string(),
        protagonist: z.string(),
        genre: z.string(),
        filmTitle: z.string(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const limited = await guard("mcpLlm", "draft_worldview");
      if (limited) return fail(limited);

      const safety = checkTextSafety(args.idea);
      if (!safety.safe) {
        return fail(`想法内容不符合安全规范：${safety.reason ?? "请调整措辞"}`);
      }

      const llmConfig = await getUserLLMConfig(ctx.userId);
      const draft = await runStructuredDraft({
        system: WORLDVIEW_DRAFT_SYSTEM,
        userPrompt: buildWorldviewDraftPrompt(args),
        schema: z.object({
          worldview: z.string().trim().min(1),
          protagonist: z.string().trim().min(1),
          genre: z.string().trim().min(1),
          filmTitle: z.string().trim().min(1),
        }),
        config: llmConfig,
        temperature: 0.9,
        maxTokens: 1024,
      });

      return ok(draft);
    }
  );

  // ------------------------------------------------------------------ 建项目
  server.registerTool(
    "create_project",
    {
      title: "创建项目",
      description:
        "新建一个漫剧项目（一集）。项目是后续脚本、分镜、出图的容器。" +
        "返回的 editorUrl 是网页编辑器深链，视觉环节（出图/配音/导出）在那里完成。",
      inputSchema: z.object({
        title: z.string().trim().max(200).optional().describe("片名"),
        description: z.string().trim().max(2000).optional().describe("简介"),
        style: z.enum(STYLE_VALUES).optional().describe(STYLE_DESCRIPTION),
        aspectRatio: z
          .enum(["9:16", "16:9", "1:1", "4:3", "3:4"])
          .optional()
          .describe("画幅，短剧默认竖屏 9:16"),
      }),
      outputSchema: z.object({
        projectId: z.string(),
        title: z.string(),
        editorUrl: z.string(),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const limited = await guard("mcpDefault", "create_project");
      if (limited) return fail(limited);

      const project = await prisma.project.create({
        data: {
          userId: ctx.userId,
          title: args.title?.trim() || "未命名漫剧",
          description: args.description?.trim() || null,
          ...(args.style ? { style: args.style } : {}),
          ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}),
        },
        select: { id: true, title: true },
      });

      return ok({
        projectId: project.id,
        title: project.title,
        editorUrl: editorUrl(base, project.id),
      });
    }
  );

  // -------------------------------------------------------------- 生成短剧脚本
  server.registerTool(
    "generate_drama_script",
    {
      title: "生成短剧脚本",
      description:
        "由世界观生成结构化短剧脚本（含分场、对白、旁白、时长）。这一步是长文本 LLM 调用，" +
        "通常需要 1-2 分钟，期间会持续上报进度。系列续集会自动衔接前几集的故事圣经与结尾钩子。",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("目标项目 id"),
        worldview: z.string().trim().min(1).max(8000).describe("世界观设定"),
        protagonist: z
          .string()
          .trim()
          .max(2000)
          .optional()
          .describe("主角设定"),
        characterNames: z
          .array(z.string().max(100))
          .max(20)
          .optional()
          .describe("希望出场的角色名"),
        filmTitle: z.string().trim().max(200).optional().describe("片名"),
        genre: z
          .string()
          .trim()
          .max(100)
          .optional()
          .describe("题材；留空沿用项目已存题材"),
        durationSec: z
          .number()
          .int()
          .min(10)
          .max(600)
          .optional()
          .describe("目标时长（秒），短剧常用 60-120"),
        aspectRatio: z.string().max(20).optional().describe("画幅"),
        style: z.enum(STYLE_VALUES).optional().describe(STYLE_DESCRIPTION),
      }),
      outputSchema: z.object({
        scriptId: z.string(),
        title: z.string(),
        logline: z.string(),
        sceneCount: z.number(),
        durationSec: z.number(),
        scenes: z.array(
          z.object({
            index: z.number(),
            description: z.string(),
            dialogue: z.string().nullable(),
            narration: z.string().nullable(),
            durationSec: z.number(),
          })
        ),
        editorUrl: z.string(),
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args, toolCtx) => {
      const limited = await guard("mcpLlm", "generate_drama_script");
      if (limited) return fail(limited);

      const project = await findOwnedProject(ctx.userId, args.projectId);
      if (!project) return fail("项目不存在或无权访问");

      const safety = checkTextSafety(args.worldview);
      if (!safety.safe) {
        return fail(
          `世界观内容不符合安全规范：${safety.reason ?? "请调整措辞"}`
        );
      }

      const llmConfig = await getUserLLMConfig(ctx.userId);
      if (!llmConfig) {
        return fail(
          "尚未配置大语言模型，请先到网页端「设置 > AI 模型配置」添加并启用一个 LLM 配置。"
        );
      }

      // 进度上报：脚本生成约 90 秒，客户端 5 分钟空闲计时器靠这些通知重置；
      // 不发的话长任务会被判定为「卡死」而中断（见 SDK responseMode: auto，
      // 首个通知会把响应升级成 SSE 流）。
      const progressToken = toolCtx.mcpReq._meta?.progressToken;
      const notifyProgress = async (progress: number, message: string) => {
        if (progressToken === undefined) return;
        await toolCtx.mcpReq
          .notify({
            method: "notifications/progress",
            params: { progressToken, progress, total: 100, message },
          })
          .catch(() => {});
      };

      await notifyProgress(5, "正在准备剧本上下文…");

      // 与 Web route 共用同一套上下文推导（题材回落 + 系列记忆），避免双路径漂移
      const previousEpisodeRecap = await derivePreviousEpisodeRecap(project);
      const genre = args.genre?.trim() || readStoredGenre(project);
      const input: DramaScriptInput = {
        worldview: args.worldview,
        ...(args.protagonist ? { protagonist: args.protagonist } : {}),
        ...(args.characterNames ? { characterNames: args.characterNames } : {}),
        ...(args.filmTitle ? { filmTitle: args.filmTitle } : {}),
        ...(args.durationSec ? { durationSec: args.durationSec } : {}),
        ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}),
        ...(args.style ? { style: args.style } : {}),
        ...(genre ? { genre } : {}),
        ...(previousEpisodeRecap ? { previousEpisodeRecap } : {}),
      };

      // 长任务期间定期心跳，避免客户端 5 分钟空闲超时
      let pct = 10;
      const heartbeat = setInterval(() => {
        pct = Math.min(90, pct + 5);
        void notifyProgress(pct, "AI 正在创作剧本…");
      }, 10_000);

      let artifact: DramaScriptArtifact;
      try {
        await notifyProgress(10, "AI 正在创作剧本…");
        artifact = await generateDramaScript(input, llmConfig ?? undefined);
      } finally {
        clearInterval(heartbeat);
      }

      await notifyProgress(95, "正在保存脚本…");

      const created = await prisma.shortDramaScript.create({
        data: {
          projectId: project.id,
          filmTitle: artifact.filmTitle,
          genre: artifact.genre,
          durationSec: artifact.durationSec,
          aspectRatio: artifact.aspectRatio,
          style: artifact.style,
          protagonist: artifact.protagonist,
          worldview: artifact.worldview,
          scriptDoc: JSON.parse(JSON.stringify(artifact)),
        },
        select: { id: true },
      });

      log.info(`MCP 脚本生成完成 project=${project.id} script=${created.id}`);

      return ok({
        scriptId: created.id,
        title: artifact.filmTitle,
        logline: artifact.logline,
        sceneCount: artifact.scenes?.length ?? 0,
        durationSec: artifact.durationSec,
        // 只回摘要字段：完整脚本可通过 comic://project/{id}/storyboard 资源读取，
        // 全量塞进工具返回会挤占上下文
        scenes: (artifact.scenes ?? []).map((s) => ({
          index: s.index,
          description: s.description,
          dialogue: s.dialogue ?? null,
          narration: s.narration ?? null,
          durationSec: s.durationSec,
        })),
        editorUrl: editorUrl(base, project.id),
      });
    }
  );

  // ------------------------------------------------------------ 脚本 → 分镜落库
  server.registerTool(
    "script_to_storyboard",
    {
      title: "脚本转分镜",
      description:
        "把已生成的脚本按结构直转为分镜列表并落库（零 LLM 调用、不耗积分）。" +
        "完成后即可到网页编辑器出图。注意：这会覆盖该项目现有的分镜列表。",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("目标项目 id"),
        scriptId: z
          .string()
          .min(1)
          .describe("脚本 id，来自 generate_drama_script 的返回"),
      }),
      outputSchema: z.object({
        sceneCount: z.number(),
        scenes: z.array(
          z.object({
            order: z.number(),
            shotType: z.string().nullable(),
            description: z.string(),
            dialogue: z.string().nullable(),
            duration: z.number(),
          })
        ),
        editorUrl: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      const limited = await guard("mcpDefault", "script_to_storyboard");
      if (limited) return fail(limited);

      const project = await findOwnedProject(ctx.userId, args.projectId);
      if (!project) return fail("项目不存在或无权访问");

      const script = await prisma.shortDramaScript.findFirst({
        where: { id: args.scriptId, projectId: project.id },
        select: { scriptDoc: true, storyboard: true },
      });
      if (!script) return fail("脚本不存在或不属于该项目");

      const doc = script.scriptDoc as unknown as DramaScriptArtifact;
      if (!doc?.scenes?.length) {
        return fail("脚本内容为空，请先用 generate_drama_script 生成脚本");
      }

      const characters = await prisma.projectCharacter.findMany({
        where: { projectId: project.id },
        select: { character: { select: { name: true } } },
      });
      const names = characters.map((c) => c.character.name);

      const drafts = dramaScriptToScenes(
        doc,
        script.storyboard as StoryboardTableArtifact | null,
        names
      );

      // 复用 Web 端同一套落库逻辑（转场/音效/花字聚合 + 分镜级配置桥接）
      const createdScenes = await rebuildProjectScenes(
        project.id,
        project,
        drafts
      );

      // 同步分镜原文，保持与网页「直接生成分镜列表」路径一致
      await prisma.project.update({
        where: { id: project.id },
        data: { inputText: scriptToInputText(doc) },
      });

      return ok({
        sceneCount: createdScenes.length,
        scenes: createdScenes.map((s) => ({
          order: s.order,
          shotType: s.shotType,
          description: s.description,
          dialogue: s.dialogue,
          duration: s.duration,
        })),
        editorUrl: editorUrl(base, project.id),
      });
    }
  );

  // ---------------------------------------------------------------- 角色花名册
  server.registerTool(
    "draft_character_roster",
    {
      title: "起草角色花名册",
      description:
        "由世界观与角色名批量生成每个角色的性别、年龄、一句话人设。" +
        "用于建角色档案前先把设定敲定；建档与定妆在网页端完成。",
      inputSchema: z.object({
        names: z
          .array(z.string().trim().min(1))
          .min(1)
          .max(MAX_ROSTER_CHARACTERS)
          .describe(`角色名列表，最多 ${MAX_ROSTER_CHARACTERS} 个`),
        worldview: z.string().trim().min(1).describe("世界观设定"),
        protagonist: z.string().trim().optional().describe("主角设定"),
        scenesDigest: z
          .string()
          .trim()
          .optional()
          .describe("剧情梗概，帮助 AI 判断各角色定位"),
      }),
      outputSchema: z.object({
        characters: z.array(
          z.object({
            name: z.string(),
            gender: z.string(),
            age: z.string(),
            description: z.string(),
          })
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const limited = await guard("mcpLlm", "draft_character_roster");
      if (limited) return fail(limited);

      const llmConfig = await getUserLLMConfig(ctx.userId);
      const draft = await runStructuredDraft({
        system: CHARACTER_ROSTER_SYSTEM,
        userPrompt: buildCharacterRosterPrompt(args),
        schema: z.object({
          characters: z
            .array(
              z.object({
                name: z.string(),
                gender: z.string().catch("").default(""),
                age: z.string().catch("").default(""),
                description: z.string().catch("").default(""),
              })
            )
            .catch([])
            .default([]),
        }),
        config: llmConfig,
        temperature: 0.5,
        maxTokens: 1024,
      });

      // 只保留请求 names 内的条目（LLM 可能编造多余角色），并归一 gender
      return ok({
        characters: filterRosterByNames(args.names, draft.characters),
      });
    }
  );
}
