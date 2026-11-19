import { createLogger } from "@/lib/logger";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  PublicationZ,
  PublicationPatchZ,
  PublicationActionZ,
  PublicationPayloadZ,
} from "@/lib/short-video/contracts";
import { stableHash } from "@/lib/short-video/hash";
import { invariant } from "@/lib/short-video/errors";
import { platformPostUrl } from "@/lib/short-video/source";
import { publicationTransition, dueStatus } from "@/lib/short-video/state";
import {
  canAccessShortVideo,
  shortVideoConfig,
} from "@/lib/short-video/config";
import {
  ownedVideo,
  json,
  receipt,
  page,
  pageArgs,
  userLock,
  dto,
  type Tx,
} from "./store";
import { ownedAccount, accountSelect } from "./accounts";
import { productionConnectors } from "./connectors";
import {
  SubmitResultZ,
  ReconcileResultZ,
  type PublicationSnapshot,
  type ShortVideoConnector,
} from "./connectors/contracts";
const log = createLogger("short-video:publication");
export async function ownedPublication(
  userId: string,
  id: string,
  tx: Tx = prisma
) {
  const row = await tx.svPublication.findFirst({
    where: { id, userId },
    include: {
      artifact: true,
      account: { select: accountSelect },
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  invariant(row, 404, "NOT_FOUND", "发布任务不存在");
  return row;
}
async function reviewHash(
  tx: Tx,
  userId: string,
  videoId: string,
  accountId: string,
  artifactId: string,
  payload: z.infer<typeof PublicationPayloadZ>
) {
  const account = await ownedAccount(userId, accountId, tx);
  const artifact = await tx.svArtifact.findFirst({
    where: {
      id: artifactId,
      userId,
      videoId,
      kind: "VIDEO",
      verifiedAt: { not: null },
      archivedAt: null,
    },
  });
  invariant(artifact, 404, "NOT_FOUND", "成片不存在或尚未验证");
  let cover = null;
  if (payload.coverArtifactId) {
    cover = await tx.svArtifact.findFirst({
      where: {
        id: payload.coverArtifactId,
        userId,
        videoId,
        kind: { in: ["IMAGE", "COVER"] },
        verifiedAt: { not: null },
        archivedAt: null,
      },
    });
    invariant(cover, 404, "NOT_FOUND", "封面不存在");
  }
  return stableHash({
    platform: account.platform,
    accountId,
    externalAccountId: account.externalAccountId,
    artifact: artifact.sha256,
    cover: cover?.sha256 ?? null,
    payload,
  });
}
async function event(
  tx: Tx,
  row: { id: string; userId: string; status: string },
  next: string,
  type: string,
  actor: "USER" | "WORKER" | "CONNECTOR",
  detail: Record<string, unknown> = {}
) {
  log.info("记录发布状态转换", {
    publicationId: row.id,
    fromStatus: row.status,
    toStatus: next,
    eventType: type,
    actorType: actor,
    phase: "transaction",
  });
  await tx.svPublicationEvent.create({
    data: {
      userId: row.userId,
      publicationId: row.id,
      eventType: type,
      fromStatus: row.status,
      toStatus: next,
      actorType: actor,
      actorId: actor === "USER" ? row.userId : null,
      detail: json(detail),
    },
  });
}
export async function readPublication(userId: string, id: string) {
  const row = await ownedPublication(userId, id);
  const { leaseToken: _, ...safe } = row;
  void _;
  return dto({
    ...safe,
    reviewHash: await reviewHash(
      prisma,
      userId,
      row.videoId,
      row.accountId,
      row.artifactId,
      PublicationPayloadZ.parse(row.payload)
    ),
  });
}
export async function listPublications(
  userId: string,
  params: Record<string, unknown>
) {
  const args = pageArgs(params);
  const f = z
    .object({
      videoId: z.string().optional(),
      accountId: z.string().optional(),
      status: z.string().optional(),
      from: z.iso.datetime({ offset: true }).optional(),
      to: z.iso.datetime({ offset: true }).optional(),
    })
    .parse(params);
  const rows = await prisma.svPublication.findMany({
    ...args,
    where: {
      ...args.where,
      userId,
      ...(f.videoId ? { videoId: f.videoId } : {}),
      ...(f.accountId ? { accountId: f.accountId } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.from || f.to
        ? {
            scheduledAt: {
              ...(f.from ? { gte: new Date(f.from) } : {}),
              ...(f.to ? { lte: new Date(f.to) } : {}),
            },
          }
        : {}),
    },
    include: { account: { select: accountSelect } },
  });
  return page(
    rows.map(({ leaseToken: _, ...row }) => {
      void _;
      return row;
    }),
    args.take
  );
}
export async function createPublication(userId: string, raw: unknown) {
  const input = PublicationZ.parse(raw);
  const ref = await receipt(userId, "publication:create", input, async (tx) => {
    const video = await ownedVideo(userId, input.videoId, tx);
    invariant(!video.archivedAt);
    const account = await ownedAccount(userId, input.accountId, tx);
    invariant(!account.disabledAt);
    const connector = productionConnectors.find(
      (c) => c.capability.connectorId === account.connectorId
    );
    if (input.mode === "AUTO")
      invariant(
        account.status === "CONNECTED" &&
          connector?.capability.publish === "VERIFIED",
        503,
        "CONNECTOR_BLOCKED",
        "自动发布能力尚未核验或账号未授权"
      );
    const hash = await reviewHash(
      tx,
      userId,
      input.videoId,
      input.accountId,
      input.artifactId,
      input.payload
    );
    const old = await tx.svPublication.findFirst({
      where: {
        userId,
        accountId: input.accountId,
        payloadHash: hash,
        status: { notIn: ["CANCELLED", "EXPIRED", "REJECTED", "FAILED"] },
      },
    });
    invariant(
      !old,
      409,
      "DUPLICATE_PUBLICATION",
      "该账号已有相同素材和文案的发布任务"
    );
    const publication = await tx.svPublication.create({
      data: {
        userId,
        videoId: input.videoId,
        accountId: input.accountId,
        artifactId: input.artifactId,
        payload: json(input.payload),
        payloadHash: hash,
        mode: input.mode,
        requestId: input.requestId,
        requestHash: stableHash(input),
        operationKey: `sv:publication:${randomUUID()}`,
      },
    });
    await event(tx, publication, "DRAFT", "CREATED", "USER");
    return { id: publication.id };
  });
  return readPublication(userId, ref.id);
}
export async function patchPublication(
  userId: string,
  id: string,
  raw: unknown
) {
  const input = PublicationPatchZ.parse(raw);
  await receipt(userId, `publication:${id}:patch`, input, async (tx) => {
    const row = await ownedPublication(userId, id, tx);
    invariant(row.status === "DRAFT" && row.version === input.expectedVersion);
    const payload = input.payload ?? PublicationPayloadZ.parse(row.payload);
    const artifactId = input.artifactId ?? row.artifactId;
    const hash = await reviewHash(
      tx,
      userId,
      row.videoId,
      row.accountId,
      artifactId,
      payload
    );
    invariant(
      !(await tx.svPublication.findFirst({
        where: {
          userId,
          id: { not: id },
          accountId: row.accountId,
          payloadHash: hash,
          status: { notIn: ["CANCELLED", "EXPIRED", "REJECTED", "FAILED"] },
        },
      })),
      409,
      "DUPLICATE_PUBLICATION",
      "已有相同发布任务"
    );
    await tx.svPublication.update({
      where: { id },
      data: {
        artifactId,
        payload: json(payload),
        payloadHash: hash,
        version: { increment: 1 },
      },
    });
    await event(tx, row, "DRAFT", "EDITED", "USER");
    return { id };
  });
  return readPublication(userId, id);
}
export async function controlPublication(
  userId: string,
  id: string,
  raw: unknown
) {
  const input = PublicationActionZ.parse(raw);
  await receipt(userId, `publication:${id}:action`, input, async (tx) => {
    const row = await ownedPublication(userId, id, tx);
    invariant(row.version === input.expectedVersion);
    if (input.action === "reconcile") {
      invariant(
        ["PROCESSING", "SUBMITTING", "NEEDS_RECONCILIATION"].includes(
          row.status
        )
      );
      await tx.svPublication.update({
        where: { id },
        data: { nextCheckAt: new Date(), version: { increment: 1 } },
      });
      return { id };
    }
    const next = publicationTransition(row.status, input.action);
    const data: Parameters<Tx["svPublication"]["update"]>[0]["data"] = {
      status: next,
      version: { increment: 1 },
    };
    const hash = await reviewHash(
      tx,
      userId,
      row.videoId,
      row.accountId,
      row.artifactId,
      PublicationPayloadZ.parse(row.payload)
    );
    if (input.action === "approve") {
      invariant(
        input.approvedHash === hash && row.payloadHash === hash,
        409,
        "REVIEW_CHANGED",
        "审核内容已变化，请重新预览"
      );
      data.approvedHash = hash;
      data.approvedById = userId;
      data.approvedAt = new Date();
    } else if (input.action === "schedule") {
      invariant(
        input.approvedHash === hash && row.approvedHash === hash,
        409,
        "REVIEW_CHANGED",
        "当前内容尚未审核"
      );
      invariant(
        input.scheduledAt &&
          new Date(input.scheduledAt).getTime() >= Date.now() + 60000,
        422,
        "SCHEDULE_TOO_SOON",
        "计划提交时间至少为当前时间60秒后"
      );
      invariant(
        !row.account.disabledAt,
        409,
        "ACCOUNT_DISABLED",
        "发布账号已断开"
      );
      data.scheduledAt = new Date(input.scheduledAt);
      data.displayTimeZone = input.timeZone || shortVideoConfig().timeZone;
    } else if (input.action === "mark_manual_published") {
      invariant(
        row.mode === "MANUAL" && input.externalUrl && input.publishedAt,
        422,
        "RECEIPT_REQUIRED",
        "请提供真实平台作品链接与发布时间"
      );
      const url = platformPostUrl(row.account.platform, input.externalUrl);
      invariant(
        url.pathname !== "/" && new Date(input.publishedAt) <= new Date(),
        422,
        "INVALID_POST_RECEIPT",
        "请填写真实作品链接和已发生的发布时间"
      );
      data.externalUrl = url.toString();
      data.publishedAt = new Date(input.publishedAt);
    }
    invariant(
      (
        await tx.svPublication.updateMany({
          where: { id, version: row.version, status: row.status },
          data,
        })
      ).count
    );
    await event(
      tx,
      row,
      next,
      input.action.toUpperCase(),
      "USER",
      input.action === "mark_manual_published"
        ? { verification: "USER_REPORTED" }
        : {}
    );
    return { id };
  });
  return readPublication(userId, id);
}
function snapshot(
  row: Awaited<ReturnType<typeof ownedPublication>>
): PublicationSnapshot {
  return {
    platform: z
      .enum(["DOUYIN", "KUAISHOU", "XIAOHONGSHU"])
      .parse(row.account.platform),
    accountId: row.accountId,
    artifact: {
      storageKey: row.artifact.storageKey,
      sha256: row.artifact.sha256,
      mimeType: row.artifact.mimeType,
      bytes: row.artifact.bytes.toString(),
      durationMs: row.artifact.durationMs,
      width: row.artifact.width,
      height: row.artifact.height,
    },
    payload: PublicationPayloadZ.parse(row.payload),
  };
}
async function reconcilePublication(
  row: Awaited<ReturnType<typeof ownedPublication>>,
  connectors: readonly ShortVideoConnector[]
) {
  const connector = connectors.find(
    (c) =>
      c.capability.connectorId === row.account.connectorId &&
      c.capability.supportsSubmissionLookup &&
      c.capability.publish === "VERIFIED"
  );
  let result: z.infer<typeof ReconcileResultZ> = { status: "unknown" };
  if (connector?.reconcile) {
    try {
      result = ReconcileResultZ.parse(
        await connector.reconcile(
          {
            operationKey: row.operationKey,
            submissionId: row.externalSubmissionId,
          },
          { userId: row.userId, accountId: row.accountId }
        )
      );
    } catch {
      /* 无副作用核对失败保留未知，不补单。 */
    }
  }
  if (result.status === "published")
    platformPostUrl(row.account.platform, result.url!);
  const next = {
    processing: "PROCESSING",
    published: "PUBLISHED",
    rejected: "REJECTED",
    not_submitted: "FAILED",
    unknown: "NEEDS_RECONCILIATION",
  }[result.status];
  await prisma.$transaction(async (tx) => {
    await userLock(tx, row.userId);
    const current = await ownedPublication(row.userId, row.id, tx);
    if (
      !["SUBMITTING", "PROCESSING", "NEEDS_RECONCILIATION"].includes(
        current.status
      )
    )
      return;
    await tx.svPublication.update({
      where: { id: row.id },
      data: {
        status: next,
        externalPostId: result.postId,
        externalUrl: result.url,
        publishedAt: result.publishedAt
          ? new Date(result.publishedAt)
          : undefined,
        nextCheckAt: new Date(Date.now() + 60000),
        leaseToken: null,
        leaseUntil: null,
        version: { increment: 1 },
      },
    });
    await event(
      tx,
      current,
      next,
      "RECONCILED",
      "CONNECTOR",
      result.status === "published"
        ? { verification: "CONNECTOR_CONFIRMED" }
        : { result: result.status }
    );
  });
}
export async function sweepPublications(
  token: string,
  connectors: readonly ShortVideoConnector[] = productionConnectors
) {
  const now = new Date();
  const existing = await prisma.svPublication.findMany({
    where: {
      status: { in: ["SUBMITTING", "PROCESSING", "NEEDS_RECONCILIATION"] },
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] },
      ],
    },
    take: 50,
  });
  for (const row of existing)
    await reconcilePublication(
      await ownedPublication(row.userId, row.id),
      connectors
    );
  if (!shortVideoConfig().enabled) return;
  const due = await prisma.svPublication.findMany({
    where: {
      status: { in: ["SCHEDULED", "CLAIMED"] },
      scheduledAt: { lte: now },
    },
    orderBy: { scheduledAt: "asc" },
    take: 50,
    include: { user: true },
  });
  for (const row of due) {
    if (!canAccessShortVideo(row.user)) continue;
    const claimed = await prisma.$transaction(async (tx) => {
      await userLock(tx, row.userId);
      const current = await ownedPublication(row.userId, row.id, tx);
      if (
        !["SCHEDULED", "CLAIMED"].includes(current.status) ||
        (current.leaseUntil && current.leaseUntil > new Date())
      )
        return null;
      let next = dueStatus(
        current.scheduledAt!,
        new Date(),
        current.mode,
        shortVideoConfig().latenessSec
      );
      if (!next) return null;
      if (current.account.disabledAt) next = "BLOCKED";
      if (
        next === "CLAIMED" &&
        (await tx.svPublication.findFirst({
          where: {
            id: { not: current.id },
            status: { in: ["SUBMITTING", "NEEDS_RECONCILIATION"] },
          },
          select: { id: true },
        }))
      )
        return null;
      if (
        next === "CLAIMED" &&
        (!shortVideoConfig().autoSubmit ||
          !shortVideoConfig().publishConcurrency)
      )
        return null;
      await tx.svPublication.update({
        where: { id: current.id },
        data: {
          status: next,
          leaseToken: next === "CLAIMED" ? token : null,
          leaseUntil:
            next === "CLAIMED"
              ? new Date(Date.now() + shortVideoConfig().leaseMs)
              : null,
          version: { increment: 1 },
        },
      });
      await event(tx, current, next, next, "WORKER");
      return next === "CLAIMED"
        ? ownedPublication(row.userId, row.id, tx)
        : null;
    });
    if (!claimed) continue;
    const connector = connectors.find(
      (c) =>
        c.capability.connectorId === claimed.account.connectorId &&
        c.capability.publish === "VERIFIED"
    );
    // 尚未核验的平台没有任何生产submit实现；测试可显式注入契约适配器。
    if (
      !connector?.submit ||
      !connector.validate ||
      claimed.account.status !== "CONNECTED" ||
      (claimed.account.credentialExpiresAt &&
        claimed.account.credentialExpiresAt <= new Date())
    ) {
      await prisma.$transaction(async (tx) => {
        await userLock(tx, claimed.userId);
        const current = await ownedPublication(claimed.userId, claimed.id, tx);
        if (current.status !== "CLAIMED" || current.leaseToken !== token)
          return;
        await tx.svPublication.update({
          where: { id: claimed.id },
          data: {
            status: "BLOCKED",
            errorCode: "CONNECTOR_BLOCKED",
            errorSummary: "自动发布能力或授权不可用",
            version: { increment: 1 },
          },
        });
        await event(tx, current, "BLOCKED", "BLOCKED", "WORKER");
      });
      continue;
    }
    const validation = await connector.validate(snapshot(claimed), {
      userId: claimed.userId,
      accountId: claimed.accountId,
    });
    const submit = await prisma.$transaction(async (tx) => {
      await userLock(tx, claimed.userId);
      const current = await ownedPublication(claimed.userId, claimed.id, tx);
      if (
        current.status !== "CLAIMED" ||
        current.leaseToken !== token ||
        !current.leaseUntil ||
        current.leaseUntil <= new Date() ||
        current.account.disabledAt ||
        !shortVideoConfig().autoSubmit
      )
        return false;
      const hash = await reviewHash(
        tx,
        current.userId,
        current.videoId,
        current.accountId,
        current.artifactId,
        PublicationPayloadZ.parse(current.payload)
      );
      invariant(
        current.approvedHash === hash && validation.valid,
        409,
        "PUBLISH_VALIDATION",
        "平台校验或审核快照失效"
      );
      await tx.svPublication.update({
        where: { id: current.id },
        data: {
          status: "SUBMITTING",
          submissionStartedAt: new Date(),
          attemptCount: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await event(tx, current, "SUBMITTING", "SUBMITTING", "WORKER");
      return true;
    });
    if (!submit) continue;
    let result: z.infer<typeof SubmitResultZ> = { status: "unknown" };
    try {
      result = SubmitResultZ.parse(
        await connector.submit(snapshot(claimed), claimed.operationKey, {
          userId: claimed.userId,
          accountId: claimed.accountId,
        })
      );
    } catch {
      /* 传输失败不等于未受理。 */
    }
    await prisma.$transaction(async (tx) => {
      await userLock(tx, claimed.userId);
      const current = await ownedPublication(claimed.userId, claimed.id, tx);
      if (current.status !== "SUBMITTING" || current.leaseToken !== token)
        return;
      const next =
        result.status === "accepted"
          ? "PROCESSING"
          : result.status === "known_rejected"
            ? "REJECTED"
            : "NEEDS_RECONCILIATION";
      await tx.svPublication.update({
        where: { id: current.id },
        data: {
          status: next,
          externalSubmissionId:
            result.status === "accepted" ? result.submissionId : null,
          submittedAt: result.status === "accepted" ? new Date() : null,
          nextCheckAt: new Date(Date.now() + 60000),
          leaseToken: null,
          leaseUntil: null,
          version: { increment: 1 },
        },
      });
      await event(tx, current, next, "SUBMISSION_RESULT", "CONNECTOR", {
        result: result.status,
      });
    });
  }
}
