import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  canAccessShortVideo,
  shortVideoConfig,
} from "@/lib/short-video/config";
import { invariant } from "@/lib/short-video/errors";
import { runLock, userLock, type Tx } from "./store";
import { ownedRun } from "./runs";
export type RunLease = { runId: string; userId: string; token: string };
export async function acquireWorkerLease(owner: string) {
  const token = randomUUID();
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('sv-worker-global', 0))`;
    const old = await tx.svWorker.findUnique({ where: { id: "global" } });
    if (old?.leaseUntil && old.leaseUntil > now) return null;
    await tx.svWorker.upsert({
      where: { id: "global" },
      create: {
        id: "global",
        leaseToken: token,
        leaseUntil: new Date(Date.now() + shortVideoConfig().leaseMs),
        heartbeatAt: now,
        metadata: { owner },
      },
      update: {
        leaseToken: token,
        leaseUntil: new Date(Date.now() + shortVideoConfig().leaseMs),
        heartbeatAt: now,
        metadata: { owner },
      },
    });
    return token;
  });
}
export async function acquireRunLease(
  runId: string,
  token: string,
  owner: string
) {
  const row = await prisma.svRun.findUnique({
    where: { id: runId },
    include: { user: true },
  });
  if (!row || !canAccessShortVideo(row.user) || !row.confirmedAt) return null;
  return prisma.$transaction(async (tx) => {
    await userLock(tx, row.userId);
    await runLock(tx, runId);
    const changed = await tx.svRun.updateMany({
      where: {
        id: runId,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      data: {
        leaseToken: token,
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + shortVideoConfig().leaseMs),
        heartbeatAt: new Date(),
      },
    });
    return changed.count ? { runId, userId: row.userId, token } : null;
  });
}
export async function fenced<T>(
  lease: RunLease,
  fn: (tx: Tx, run: Awaited<ReturnType<typeof ownedRun>>) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await userLock(tx, lease.userId);
      await runLock(tx, lease.runId);
      const run = await ownedRun(lease.userId, lease.runId, tx);
      invariant(
        run.leaseToken === lease.token &&
          run.leaseUntil &&
          run.leaseUntil > new Date(),
        409,
        "LEASE_LOST",
        "执行租约已失效，只允许当前执行器更新"
      );
      return fn(tx, run);
    },
    { timeout: 20000 }
  );
}
export async function renewWorker(token: string) {
  const until = new Date(Date.now() + shortVideoConfig().leaseMs);
  const now = new Date();
  const updated = await prisma.svWorker.updateMany({
    where: { id: "global", leaseToken: token, leaseUntil: { gt: now } },
    data: { leaseUntil: until, heartbeatAt: now },
  });
  if (!updated.count) return false;
  await prisma.svRun.updateMany({
    where: { leaseToken: token, leaseUntil: { gt: now } },
    data: { leaseUntil: until, heartbeatAt: now },
  });
  return true;
}
