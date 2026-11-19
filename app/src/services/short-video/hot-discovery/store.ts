import { createLogger } from "@/lib/logger";
import { ScriptZ } from "@/lib/short-video/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  HOT_BRIEF_CONNECTOR,
  HotInputZ,
  HotReportZ,
  HotRequestZ,
} from "@/lib/short-video/hot-discovery";
import { canAccessShortVideo } from "@/lib/short-video/config";
import { invariant } from "@/lib/short-video/errors";
import { stableHash } from "@/lib/short-video/hash";
import { canonicalSource } from "@/lib/short-video/source";
import { receipt, json, dto } from "../store";
import { insertScript } from "../scripts";
import { fetchHotBoard } from "./sources";
import { buildHotBrief } from "./ideas";
const log = createLogger("short-video:hot-discovery");
export async function createHotBrief(userId: string, raw: unknown) {
  const input = HotRequestZ.parse(raw);
  const ref = await receipt(userId, "hot-brief:create", input, async (tx) => {
    invariant(
      !(await tx.svDiscoveryJob.findFirst({
        where: { userId, status: { in: ["PENDING", "RUNNING"] } },
      })),
      409,
      "DISCOVERY_ACTIVE",
      "已有搜索任务正在执行，请先读取当前任务"
    );
    const job = await tx.svDiscoveryJob.create({
      data: {
        userId,
        platform: "OTHER",
        connectorId: HOT_BRIEF_CONNECTOR,
        keywords: json(
          HotInputZ.parse({
            query: input.query,
            platforms: input.platforms,
            style: input.style,
            windowDays: input.windowDays,
          })
        ),
        requestId: input.requestId,
        requestHash: stableHash(input),
        status: "PENDING",
      },
    });
    return { id: job.id };
  });
  return readHotBrief(userId, ref.id);
}
export async function readHotBrief(userId: string, id: string) {
  const row = await prisma.svDiscoveryJob.findFirst({
    where: { id, userId, connectorId: HOT_BRIEF_CONNECTOR },
  });
  invariant(row, 404, "NOT_FOUND", "热点简报不存在");
  return dto({
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt,
    updatedAt: row.updatedAt,
    input: HotInputZ.parse(row.keywords),
    report:
      row.status === "COMPLETED" ? HotReportZ.parse(row.resultSourceIds) : null,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
  });
}
export async function latestHotBrief(userId: string) {
  const row = await prisma.svDiscoveryJob.findFirst({
    where: { userId, connectorId: HOT_BRIEF_CONNECTOR },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return { item: row ? await readHotBrief(userId, row.id) : null };
}
export async function sweepHotBriefs(
  fetchBoard = fetchHotBoard,
  stopping: () => boolean = () => false
) {
  const now = new Date();
  const jobs = await prisma.svDiscoveryJob.findMany({
    where: {
      connectorId: HOT_BRIEF_CONNECTOR,
      status: { in: ["PENDING", "RUNNING"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
    include: { user: true },
  });
  for (const job of jobs) {
    if (stopping()) break;
    if (!canAccessShortVideo(job.user)) continue;
    const token = randomUUID();
    const claimed = await prisma.svDiscoveryJob.updateMany({
      where: {
        id: job.id,
        status: job.status,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: {
        status: "RUNNING",
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 60000),
      },
    });
    if (!claimed.count) continue;
    try {
      const input = HotInputZ.parse(job.keywords);
      // 固定免费公开读取可在租约失效后重新读取；不重放模型调用或平台写入。
      const boards = await Promise.all(
        input.platforms.map((platform) =>
          fetchBoard(platform, input.query, new Date())
        )
      );
      const report = buildHotBrief(input, boards);
      log.info("公开热点简报读取完成", {
        discoveryJobId: job.id,
        sourceStates: boards.map((b) => ({
          platform: b.platform,
          status: b.status,
          count: b.items.length,
        })),
        ideaCount: report.ideas.length,
      });
      await prisma.svDiscoveryJob.updateMany({
        where: {
          id: job.id,
          status: "RUNNING",
          leaseToken: token,
          leaseUntil: { gt: new Date() },
        },
        data: {
          status: "COMPLETED",
          resultSourceIds: json(report),
          leaseToken: null,
          leaseUntil: null,
          errorCode: null,
          errorSummary: null,
        },
      });
    } catch {
      await prisma.svDiscoveryJob.updateMany({
        where: {
          id: job.id,
          leaseToken: token,
          leaseUntil: { gt: new Date() },
        },
        data: {
          status: "FAILED",
          leaseToken: null,
          leaseUntil: null,
          errorCode: "HOT_DISCOVERY_FAILED",
          errorSummary:
            "热点简报未完成，未产生付费调用或发布；请读取状态后重新搜索",
        },
      });
    }
  }
}
export async function saveHotIdea(
  userId: string,
  briefId: string,
  raw: unknown
) {
  const input = z
    .object({
      requestId: z.uuid(),
      ideaId: z.string().min(1).max(100),
      content: ScriptZ.optional(),
    })
    .strict()
    .parse(raw);
  const ref = await receipt(
    userId,
    `hot-brief:${briefId}:save`,
    input,
    async (tx) => {
      const job = await tx.svDiscoveryJob.findFirst({
        where: {
          id: briefId,
          userId,
          connectorId: HOT_BRIEF_CONNECTOR,
          status: "COMPLETED",
        },
      });
      invariant(job, 404, "NOT_FOUND", "简报尚未完成或不属于当前用户");
      const report = HotReportZ.parse(job.resultSourceIds);
      const idea = report.ideas.find((i) => i.id === input.ideaId);
      invariant(idea, 404, "NOT_FOUND", "创意不存在");
      const topic = report.topics.find((t) => t.id === idea.topicId);
      invariant(topic, 409, "EVIDENCE_MISSING", "创意缺少来源证据");
      const canonical = canonicalSource(topic.platform, topic.url, topic.title);
      const source = await tx.svSource.upsert({
        where: {
          userId_platform_canonicalKey: {
            userId,
            platform: topic.platform,
            canonicalKey: canonical.canonicalKey,
          },
        },
        update: {},
        create: {
          ...canonical,
          userId,
          platform: topic.platform,
          title: topic.title,
          summary: topic.title,
          observedAt: new Date(topic.fetchedAt),
          ingestionMode: "CONNECTOR",
          connectorId: HOT_BRIEF_CONNECTOR,
          rightsNote: "仅引用公开话题文字作为原创改编灵感，未下载第三方视频",
          rawMetadata: json({
            evidenceKind: topic.evidenceKind,
            sourceName: topic.sourceName,
            sourceUrl: topic.sourceUrl,
            snapshotAt: topic.snapshotAt,
            timeBasis: topic.timeBasis,
            rank: topic.rank,
            heatLabel: topic.heatLabel,
          }),
        },
      });
      const video = await tx.svVideo.create({
        data: {
          userId,
          title: input.content?.title ?? idea.title,
          brief: `${idea.outline}\n创作联想来源：${topic.title}，${topic.sourceName}；${topic.sourceUrl}`,
          sources: { create: { userId, sourceId: source.id } },
        },
      });
      await insertScript(
        tx,
        userId,
        video.id,
        input.content ?? idea.script,
        {
          briefId,
          ideaId: idea.id,
          topic,
          origin: "RULE_DRAFT",
          requiresUserReview: true,
        },
        "MANUAL"
      );
      return { id: video.id };
    }
  );
  return { videoId: ref.id };
}
