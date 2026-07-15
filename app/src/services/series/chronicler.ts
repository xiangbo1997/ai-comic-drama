/**
 * 史官（chronicler）——系列故事圣经的写入端。
 *
 * 每集剧本定稿后跑一次 LLM 往返，把本集抽取成结构化「变更」，再由纯函数
 * mergeBible 增量并进 Series.storyBible。与 video-director 同款静默失败模式：
 * 无 LLM 配置 / 解析失败 / 上游错误一律 log.warn + 返回 null，绝不阻断生成主流程。
 *
 * 触发时机（见 §3）：
 * - 新建下一集前 ensureEpisodeChronicled(seriesId, N)（保证续集拿到最新记忆）
 * - 短剧脚本定稿后 fire-and-forget chronicleEpisode（仅系列集）
 * - 手动 POST /api/series/[id]/chronicle
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import { getUserLLMConfig } from "@/lib/ai-config";
import { parseLooseJSON } from "@/lib/json-repair";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parseStoryBible, HOOK_TYPES } from "@/types/series-bible";
import type { SeriesStoryBible, HookType } from "@/types/series-bible";
import { mergeBible, type ChronicleExtraction } from "./bible-merge";

const log = createLogger("services:series:chronicler");

/** LLM 参数：低温、确定性，避免史官发挥 */
const CHRONICLER_TEMPERATURE = 0.3;
const CHRONICLER_MAX_TOKENS = 2048;
/** 喂给史官的分镜/场景摘要预算（避免长集塞爆 context） */
const EPISODE_DIGEST_MAX_CHARS = 6000;
/** 单场景描述截断（组装 digest 时用） */
const SCENE_LINE_MAX_CHARS = 200;

const CHRONICLER_SYSTEM = `你是一部连载漫剧的"史官"，负责为整个系列维护一份跨集永久记忆（故事圣经）。
你的任务：读完本集内容，抽取出需要沉淀进系列记忆的结构化信息，供后续每一集参考，避免长剧跑偏、伏笔遗忘、人物状态失忆。

只抽取"值得跨集记住"的信息，严格遵守：
1. episodeEntry：本集在整部剧里的功能——title（本集标题）、logline（一句话梗概 ≤100字）、protagonistChange（主角本集的关键变化 ≤60字，可空）、endingHook（本集结尾留下的悬念钩子 ≤80字）、hookType（钩子类型，必须是：悬念/反转/情绪/信息/危机 之一）。
2. characterUpdates：角色叙事状态的变化——name、state（当前处境/身心状态 ≤120字）、relationships（关系变化，可空）、arc（成长弧推进，可空）、forbiddenChanges（后续集不得违背的硬设定，如"已失去左臂"，可空）。只列本集有实质变化的角色。
3. newThreads：本集新埋下的伏笔/剧情线——title（简短标题）、note（可空）。
4. resolvedThreadTitles：本集回收/解决的伏笔标题列表（要与之前埋下的标题对应）。
5. newLocations：本集出现的新场景（需要跨集保持画风统一的地点）——name、description、mood（可空）。
6. newProps：本集出现的关键新道具/线索——name、description。
7. loreAdditions：本集新增的世界观设定要点（字符串数组，可空）。
8. themeProposal：仅当这是第 1 集时，提出一句话主题锁（全系列服务它）；非第 1 集留空。

绝不编造原文没有的信息。没有对应内容的字段给空数组/空字符串/省略。
输出仅一个 JSON 对象，不要 markdown 代码块，不要额外文字。`;

/** 史官抽取的 zod schema（容错：坏字段降级，不整块失败靠 safeParse 兜底） */
const ExtractionSchema = z.object({
  episodeEntry: z.object({
    title: z.string().catch(""),
    logline: z.string().catch(""),
    protagonistChange: z.string().optional().catch(undefined),
    endingHook: z.string().catch(""),
    hookType: z.enum(HOOK_TYPES).optional().catch(undefined),
  }),
  characterUpdates: z
    .array(
      z.object({
        name: z.string(),
        state: z.string().catch(""),
        relationships: z.string().optional().catch(undefined),
        arc: z.string().optional().catch(undefined),
        forbiddenChanges: z.string().optional().catch(undefined),
      })
    )
    .catch([]),
  newThreads: z
    .array(
      z.object({
        title: z.string(),
        note: z.string().optional().catch(undefined),
      })
    )
    .catch([]),
  resolvedThreadTitles: z.array(z.string()).catch([]),
  newLocations: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().catch(""),
        mood: z.string().optional().catch(undefined),
      })
    )
    .catch([]),
  newProps: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().catch(""),
      })
    )
    .catch([]),
  loreAdditions: z.array(z.string()).catch([]),
  themeProposal: z.string().optional().catch(undefined),
});

/** 本集内容摘要（喂给史官）：优先用已定稿的短剧脚本，无则用分镜兜底 */
interface EpisodeContent {
  title: string;
  digest: string;
  /**
   * 本集结尾钩子类型：DramaScriptAgent 产出时已随 scriptDoc 落库。
   * 存在则直接采纳（跳过 LLM 重推）；缺失（老数据 / 分镜兜底路径）时为 undefined，
   * 交由史官 LLM 从内容推断兜底。
   */
  hookType?: HookType;
}

/** 解析史官响应（纯函数、可测）；失败返回 null（调用方静默降级） */
export function parseChronicleResponse(
  raw: string
): ChronicleExtraction | null {
  let parsed: unknown;
  try {
    parsed = parseLooseJSON(raw);
  } catch {
    return null;
  }
  const result = ExtractionSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

/** 组装本集内容摘要：优先最新短剧脚本 scriptDoc，无则用分镜行 */
async function loadEpisodeContent(
  projectId: string
): Promise<EpisodeContent | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { title: true },
  });
  if (!project) return null;

  const script = await prisma.shortDramaScript.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: { filmTitle: true, scriptDoc: true },
  });
  const doc = script?.scriptDoc as
    | {
        logline?: unknown;
        hookType?: unknown;
        scenes?: Array<{
          title?: string;
          description?: string;
          dialogue?: string | null;
          narration?: string | null;
        }>;
      }
    | null
    | undefined;

  // DramaScriptAgent 产出的钩子类型随 scriptDoc 落库；命中五分类枚举才采纳，
  // 否则（老数据 / 非法值）留 undefined 交由史官 LLM 推断兜底。
  const storedHookType = HOOK_TYPES.includes(doc?.hookType as HookType)
    ? (doc?.hookType as HookType)
    : undefined;

  if (doc?.scenes && doc.scenes.length > 0) {
    const lines: string[] = [];
    if (typeof doc.logline === "string" && doc.logline.trim()) {
      lines.push(`梗概：${doc.logline.trim()}`);
    }
    for (const s of doc.scenes) {
      const desc = (s.description ?? "").trim().slice(0, SCENE_LINE_MAX_CHARS);
      if (!desc) continue;
      const bits = [desc];
      if (s.dialogue?.trim()) bits.push(`对白「${s.dialogue.trim()}」`);
      if (s.narration?.trim()) bits.push(`旁白「${s.narration.trim()}」`);
      lines.push(`- ${bits.join("；")}`);
    }
    return {
      title: script?.filmTitle ?? project.title,
      digest: lines.join("\n").slice(0, EPISODE_DIGEST_MAX_CHARS),
      hookType: storedHookType,
    };
  }

  // 兜底：从 Scene 表按 order 组装
  const scenes = await prisma.scene.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { description: true, dialogue: true, narration: true },
  });
  if (scenes.length === 0) return null;
  const lines = scenes
    .filter((s) => s.description?.trim())
    .map((s) => {
      const bits = [s.description.trim().slice(0, SCENE_LINE_MAX_CHARS)];
      if (s.dialogue?.trim()) bits.push(`对白「${s.dialogue.trim()}」`);
      if (s.narration?.trim()) bits.push(`旁白「${s.narration.trim()}」`);
      return `- ${bits.join("；")}`;
    });
  if (lines.length === 0) return null;
  return {
    title: project.title,
    digest: lines.join("\n").slice(0, EPISODE_DIGEST_MAX_CHARS),
  };
}

/** 构建史官 user prompt（纯函数、可测） */
export function buildChroniclerPrompt(args: {
  episodeNumber: number;
  content: EpisodeContent;
  currentBible: SeriesStoryBible;
}): string {
  const { episodeNumber, content, currentBible } = args;
  const parts: string[] = [];

  parts.push(`【正在归档：第${episodeNumber}集《${content.title}》】`);

  // 已有记忆的精要（让史官知道哪些伏笔待回收、角色现状，避免重复埋线）
  const openThreads = currentBible.threads.filter((t) => t.status === "open");
  if (openThreads.length > 0) {
    parts.push(
      `【当前未解决的伏笔（若本集回收，写进 resolvedThreadTitles）】\n` +
        openThreads.map((t) => `- ${t.title}`).join("\n")
    );
  }
  if (currentBible.characters.length > 0) {
    parts.push(
      `【角色已知状态（有变化才写进 characterUpdates）】\n` +
        currentBible.characters.map((c) => `- ${c.name}：${c.state}`).join("\n")
    );
  }

  parts.push(`【本集内容】\n${content.digest}`);
  parts.push(
    `请抽取本集需要沉淀进系列记忆的结构化信息，输出 JSON。` +
      (episodeNumber === 1 && !currentBible.theme
        ? "（这是第 1 集，请给出 themeProposal）"
        : "")
  );

  return parts.join("\n\n");
}

/**
 * 归档单集：LLM 抽取 + mergeBible + 落库。静默失败（返回 null）。
 * @returns 更新后的圣经；失败返回 null
 */
export async function chronicleEpisode(args: {
  seriesId: string;
  projectId: string;
  episodeNumber: number;
  userId: string;
}): Promise<SeriesStoryBible | null> {
  const { seriesId, projectId, episodeNumber, userId } = args;
  try {
    const series = await prisma.series.findFirst({
      where: { id: seriesId, userId },
      select: { storyBible: true },
    });
    if (!series) {
      log.warn("归档跳过：系列不存在或不属于该用户", { seriesId, userId });
      return null;
    }

    const content = await loadEpisodeContent(projectId);
    if (!content) {
      log.warn("归档跳过：本集无可归档内容", { projectId, episodeNumber });
      return null;
    }

    const llmConfig = await getUserLLMConfig(userId);
    if (!llmConfig) {
      log.warn("归档跳过：无 LLM 配置", { userId });
      return null;
    }

    const currentBible = parseStoryBible(series.storyBible);
    const userPrompt = buildChroniclerPrompt({
      episodeNumber,
      content,
      currentBible,
    });

    const response = await chatCompletion(
      [
        { role: "system", content: CHRONICLER_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      {
        config: llmConfig,
        temperature: CHRONICLER_TEMPERATURE,
        maxTokens: CHRONICLER_MAX_TOKENS,
      }
    );

    const extraction = parseChronicleResponse(response);
    if (!extraction) {
      log.warn("归档失败：史官响应无法解析", { projectId, episodeNumber });
      return null;
    }

    // 钩子类型直读：DramaScriptAgent 已产出并落库的 hookType 是权威值，直接采纳，
    // 覆盖史官 LLM 从内容重推的结果（缺失时保留 LLM 推断兜底，不清空）。
    const resolvedExtraction: ChronicleExtraction = content.hookType
      ? {
          ...extraction,
          episodeEntry: {
            ...extraction.episodeEntry,
            hookType: content.hookType,
          },
        }
      : extraction;

    const nextBible = mergeBible(
      currentBible,
      resolvedExtraction,
      episodeNumber
    );
    await prisma.series.update({
      where: { id: seriesId },
      data: {
        storyBible: JSON.parse(
          JSON.stringify(nextBible)
        ) as Prisma.InputJsonValue,
      },
    });
    log.info(`归档完成：系列 ${seriesId} 第 ${episodeNumber} 集`);
    return nextBible;
  } catch (err) {
    log.warn("归档异常，静默降级", {
      seriesId,
      projectId,
      episodeNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** 同系列 in-flight 去重：避免并发触发对同一集/同系列重复归档 */
const inFlight = new Map<string, Promise<SeriesStoryBible | null>>();

/**
 * 幂等归档某集：若圣经已含该集条目则直接跳过；否则找到该集项目并归档。
 * 同系列并发调用共享同一 Promise（module-level 去重）。
 */
export async function ensureEpisodeChronicled(
  seriesId: string,
  episodeNumber: number,
  userId: string
): Promise<SeriesStoryBible | null> {
  const key = `${seriesId}:${episodeNumber}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const series = await prisma.series.findFirst({
        where: { id: seriesId, userId },
        select: { storyBible: true },
      });
      if (!series) return null;

      const bible = parseStoryBible(series.storyBible);
      // 已归档该集 → no-op
      if (bible.episodes.some((e) => e.episodeNumber === episodeNumber)) {
        return bible;
      }

      const project = await prisma.project.findFirst({
        where: { seriesId, episodeNumber, userId },
        select: { id: true },
      });
      if (!project) return bible;

      return await chronicleEpisode({
        seriesId,
        projectId: project.id,
        episodeNumber,
        userId,
      });
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}
