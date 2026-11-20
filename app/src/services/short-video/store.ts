import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { stableHash } from "@/lib/short-video/hash";
import { invariant, SvError } from "@/lib/short-video/errors";
import { canonicalSource } from "@/lib/short-video/source";
import { activeRuns } from "@/lib/short-video/state";
import {
  PlatformZ,
  PageZ,
  SourceZ,
  VideoZ,
  VideoPatchZ,
  VideoListZ,
  TemplateFieldsZ,
  VersionZ,
} from "@/lib/short-video/contracts";
import { z } from "zod";
export type Tx = Prisma.TransactionClient;
export const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
export const dto = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
export async function userLock(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sv-user:${userId}`}, 0))`;
}
export async function runLock(tx: Tx, runId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sv-run:${runId}`}, 0))`;
}
export async function replayReceipt(
  userId: string,
  scope: string,
  input: { requestId: string }
) {
  const row = await prisma.svRequestReceipt.findUnique({
    where: {
      userId_scope_requestId: { userId, scope, requestId: input.requestId },
    },
  });
  if (!row) return null;
  invariant(
    row.requestHash === stableHash(input),
    409,
    "IDEMPOTENCY_CONFLICT",
    "同一请求编号的参数不能变化"
  );
  return row.responseRef as { id: string };
}
export async function receipt(
  userId: string,
  scope: string,
  input: { requestId: string },
  fn: (tx: Tx) => Promise<{ id: string }>
) {
  return prisma.$transaction(
    async (tx) => {
      await userLock(tx, userId);
      const hash = stableHash(input);
      const old = await tx.svRequestReceipt.findUnique({
        where: {
          userId_scope_requestId: { userId, scope, requestId: input.requestId },
        },
      });
      if (old) {
        invariant(
          old.requestHash === hash,
          409,
          "IDEMPOTENCY_CONFLICT",
          "同一请求编号的参数不能变化"
        );
        return old.responseRef as { id: string };
      }
      const ref = await fn(tx);
      await tx.svRequestReceipt.create({
        data: {
          userId,
          scope,
          requestId: input.requestId,
          requestHash: hash,
          responseRef: ref,
        },
      });
      return ref;
    },
    { timeout: 20000 }
  );
}
export async function ownedVideo(userId: string, id: string, tx: Tx = prisma) {
  const row = await tx.svVideo.findFirst({
    where: { id, userId },
    include: { sources: { include: { source: true } }, template: true },
  });
  invariant(row, 404, "NOT_FOUND", "作品不存在");
  return row;
}
export async function assertIdle(tx: Tx, videoId: string) {
  invariant(
    !(await tx.svRun.findFirst({
      where: {
        videoId,
        OR: [
          { status: { in: activeRuns } },
          {
            steps: {
              some: { status: { in: ["SUBMITTING", "PROCESSING", "UNKNOWN"] } },
            },
          },
        ],
      },
    })),
    409,
    "ACTIVE_RUN",
    "请先停止并核对当前任务"
  );
}
export function pageArgs(params: Record<string, unknown>) {
  const { limit, cursor } = PageZ.parse(params);
  let after: { createdAt: Date; id: string } | undefined;
  if (cursor) {
    try {
      const [date, id] = z
        .tuple([z.iso.datetime(), z.string().min(1).max(100)])
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
      after = { createdAt: new Date(date), id };
    } catch {
      throw new SvError(422, "INVALID_CURSOR", "分页游标无效");
    }
  }
  return {
    take: limit + 1,
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    where: after
      ? {
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }
      : {},
  };
}
export function page<T extends { id: string; createdAt: Date }>(
  rows: T[],
  take: number
) {
  const more = rows.length === take;
  const items = more ? rows.slice(0, -1) : rows;
  const last = items.at(-1);
  return {
    items: dto(items),
    nextCursor:
      more && last
        ? Buffer.from(
            JSON.stringify([last.createdAt.toISOString(), last.id])
          ).toString("base64url")
        : null,
  };
}
export async function importSource(userId: string, raw: unknown) {
  const input = SourceZ.parse(raw);
  const ref = await receipt(userId, "source:import", input, async (tx) => {
    const canonical = canonicalSource(input.platform, input.url, input.summary);
    const source = await tx.svSource.upsert({
      where: {
        userId_platform_canonicalKey: {
          userId,
          platform: input.platform,
          canonicalKey: canonical.canonicalKey,
        },
      },
      update: {},
      create: {
        userId,
        ...canonical,
        platform: input.platform,
        summary: input.summary,
        title: input.title,
        rightsNote: input.rightsNote,
      },
    });
    return { id: source.id };
  });
  return prisma.svSource.findFirstOrThrow({ where: { id: ref.id, userId } });
}
export async function listSources(
  userId: string,
  params: Record<string, unknown>
) {
  const args = pageArgs(params);
  const filters = z
    .object({
      platform: PlatformZ.optional(),
      q: z.string().max(200).optional(),
    })
    .parse(params);
  return page(
    await prisma.svSource.findMany({
      ...args,
      where: {
        ...args.where,
        userId,
        archivedAt: null,
        ...(filters.platform ? { platform: filters.platform } : {}),
        ...(filters.q
          ? { summary: { contains: filters.q, mode: "insensitive" } }
          : {}),
      },
    }),
    args.take
  );
}
export async function ensureTemplates(userId: string) {
  await prisma.$transaction(async (tx) => {
    await userLock(tx, userId);
    for (const [defaultKey, name, description, systemInstructions] of [
      [
        "office-animals",
        "打工动物",
        "原创动物同事与办公室荒诞日常",
        "原创动物角色，将职场情绪改编为温和荒诞反转；不使用已知IP，不复刻原视频。",
      ],
      [
        "epic-daily",
        "生活小事史诗化",
        "将日常琐事夸张为史诗冒险",
        "将生活小事用史诗语气表达，使用原创角色、明确笑点与反转，不复制来源。",
      ],
    ])
      await tx.svTemplate.upsert({
        where: { userId_defaultKey: { userId, defaultKey } },
        update: {},
        create: { userId, defaultKey, name, description, systemInstructions },
      });
  });
}
export async function listTemplates(
  userId: string,
  params: Record<string, unknown> = {}
) {
  await ensureTemplates(userId);
  const args = pageArgs(params);
  return page(
    await prisma.svTemplate.findMany({
      ...args,
      where: { ...args.where, userId },
    }),
    args.take
  );
}
export async function saveTemplate(
  userId: string,
  id: string | undefined,
  raw: unknown
) {
  const input = (
    id
      ? VersionZ.extend(TemplateFieldsZ.shape)
      : z.object({ requestId: z.uuid(), ...TemplateFieldsZ.shape })
  )
    .strict()
    .parse(raw);
  const ref = await receipt(
    userId,
    `template:${id ?? "create"}`,
    input,
    async (tx) => {
      const fields = TemplateFieldsZ.parse(input);
      if (!id)
        return {
          id: (await tx.svTemplate.create({ data: { userId, ...fields } })).id,
        };
      invariant(
        await tx.svTemplate.findFirst({ where: { id, userId } }),
        404,
        "NOT_FOUND",
        "模板不存在"
      );
      const version =
        "expectedVersion" in input ? Number(input.expectedVersion) : 0;
      const changed = await tx.svTemplate.updateMany({
        where: { id, userId, version },
        data: { ...fields, version: { increment: 1 } },
      });
      invariant(changed.count);
      return { id };
    }
  );
  return prisma.svTemplate.findFirstOrThrow({ where: { id: ref.id, userId } });
}
export async function createVideo(userId: string, raw: unknown) {
  const input = VideoZ.parse(raw);
  const ref = await receipt(userId, "video:create", input, async (tx) => {
    const ids = [...new Set(input.sourceIds)];
    invariant(
      (await tx.svSource.count({
        where: { id: { in: ids }, userId, archivedAt: null },
      })) === ids.length,
      404,
      "NOT_FOUND",
      "来源不存在"
    );
    if (input.templateId)
      invariant(
        await tx.svTemplate.findFirst({
          where: { id: input.templateId, userId, enabled: true },
        }),
        404,
        "NOT_FOUND",
        "模板不存在"
      );
    const row = await tx.svVideo.create({
      data: {
        userId,
        title: input.title,
        brief: input.brief,
        templateId: input.templateId,
        sources: { create: ids.map((sourceId) => ({ sourceId, userId })) },
      },
    });
    return { id: row.id };
  });
  return videoDetail(userId, ref.id);
}
export async function patchVideo(userId: string, id: string, raw: unknown) {
  const input = VideoPatchZ.parse(raw);
  await receipt(userId, `video:${id}:patch`, input, async (tx) => {
    await ownedVideo(userId, id, tx);
    await assertIdle(tx, id);
    if (input.templateId)
      invariant(
        await tx.svTemplate.findFirst({
          where: { id: input.templateId, userId, enabled: true },
        }),
        404,
        "NOT_FOUND",
        "模板不存在或已停用"
      );
    invariant(
      (
        await tx.svVideo.updateMany({
          where: { id, userId, version: input.expectedVersion },
          data: {
            title: input.title,
            brief: input.brief,
            templateId: input.templateId,
            ...(input.archived !== undefined
              ? { archivedAt: input.archived ? new Date() : null }
              : {}),
            version: { increment: 1 },
          },
        })
      ).count
    );
    return { id };
  });
  return videoDetail(userId, id);
}
export async function listVideos(
  userId: string,
  params: Record<string, unknown>
) {
  const args = pageArgs(params);
  const filters = VideoListZ.parse(params);
  const ready: Prisma.SvVideoWhereInput = {
    currentArtifact: {
      is: {
        userId,
        kind: "VIDEO",
        verifiedAt: { not: null },
        archivedAt: null,
      },
    },
  };
  const progress: Prisma.SvVideoWhereInput =
    filters.status === "READY"
      ? ready
      : filters.status
        ? {
            NOT: ready,
            currentScriptVersionId:
              filters.status === "SCRIPTED" ? { not: null } : null,
          }
        : {};
  const rows = await prisma.svVideo.findMany({
    ...args,
    where: {
      userId,
      archivedAt: null,
      // 游标与检索都含OR，必须用AND组合，避免续页丢失筛选条件。
      AND: [
        args.where,
        progress,
        ...(filters.q
          ? [
              {
                OR: [
                  {
                    title: {
                      contains: filters.q,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    brief: {
                      contains: filters.q,
                      mode: "insensitive" as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    },
    include: {
      currentArtifact: {
        select: {
          kind: true,
          userId: true,
          verifiedAt: true,
          archivedAt: true,
        },
      },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, kind: true },
      },
    },
  });
  return page(
    rows.map(({ currentArtifact, ...row }) => ({
      ...row,
      workflowStatus:
        currentArtifact?.kind === "VIDEO" &&
        currentArtifact.userId === userId &&
        currentArtifact.verifiedAt &&
        !currentArtifact.archivedAt
          ? "READY"
          : row.currentScriptVersionId
            ? "SCRIPTED"
            : "DRAFT",
    })),
    args.take
  );
}
export async function videoDetail(userId: string, id: string) {
  const row = await ownedVideo(userId, id);
  const [scripts, artifacts, runs] = await Promise.all([
    prisma.svScriptVersion.findMany({
      where: { videoId: id, userId },
      orderBy: { version: "desc" },
    }),
    prisma.svArtifact.findMany({
      where: { videoId: id, userId, archivedAt: null },
      orderBy: { version: "desc" },
    }),
    prisma.svRun.findMany({
      where: { videoId: id, userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        kind: true,
        version: true,
        createdAt: true,
      },
    }),
  ]);
  return dto({ ...row, scripts, artifacts, runs });
}
