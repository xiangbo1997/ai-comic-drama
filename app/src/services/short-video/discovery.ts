import { HOT_BRIEF_CONNECTOR } from "@/lib/short-video/hot-discovery";
import { prisma } from "@/lib/prisma";
import { DiscoveryZ } from "@/lib/short-video/contracts";
import { canonicalSource } from "@/lib/short-video/source";
import { stableHash } from "@/lib/short-video/hash";
import { canAccessShortVideo } from "@/lib/short-video/config";
import { invariant } from "@/lib/short-video/errors";
import { productionConnectors } from "./connectors";
import {
  DiscoveryResultZ,
  type ShortVideoConnector,
} from "./connectors/contracts";
import { json, receipt, userLock } from "./store";
export async function createDiscovery(userId: string, raw: unknown) {
  const input = DiscoveryZ.parse(raw);
  const ref = await receipt(userId, "discovery:create", input, async (tx) => {
    const connector = productionConnectors.find(
      (c) =>
        c.capability.connectorId === input.connectorId &&
        c.capability.platform === input.platform &&
        c.capability.discovery === "VERIFIED" &&
        c.search
    );
    invariant(
      !(await tx.svDiscoveryJob.findFirst({
        where: { userId, status: { in: ["PENDING", "RUNNING"] } },
      })),
      409,
      "DISCOVERY_ACTIVE",
      "已有搜索任务正在执行"
    );
    const job = await tx.svDiscoveryJob.create({
      data: {
        userId,
        platform: input.platform,
        connectorId: input.connectorId,
        keywords: input.keywords,
        requestId: input.requestId,
        requestHash: stableHash(input),
        status: connector ? "PENDING" : "BLOCKED",
        ...(!connector
          ? {
              errorCode: "CONNECTOR_BLOCKED",
              errorSummary:
                "未配置已验证搜索来源，未发起任何外部请求；可手动导入",
            }
          : {}),
      },
    });
    return { id: job.id };
  });
  return readDiscovery(userId, ref.id);
}
export async function readDiscovery(userId: string, id: string) {
  const row = await prisma.svDiscoveryJob.findFirst({ where: { id, userId } });
  invariant(row, 404, "NOT_FOUND", "搜索任务不存在");
  const { leaseToken: _, ...safe } = row;
  void _;
  return safe;
}
export async function sweepDiscovery(
  connectors: readonly ShortVideoConnector[] = productionConnectors
) {
  const jobs = await prisma.svDiscoveryJob.findMany({
    where: {
      connectorId: { not: HOT_BRIEF_CONNECTOR },
      status: { in: ["PENDING", "RUNNING"] },
    },
    take: 20,
    include: { user: true },
  });
  for (const job of jobs) {
    if (!canAccessShortVideo(job.user)) continue;
    const connector = connectors.find(
      (c) =>
        c.capability.connectorId === job.connectorId &&
        c.capability.platform === job.platform &&
        c.capability.discovery === "VERIFIED"
    );
    if (!connector?.search) {
      await prisma.svDiscoveryJob.update({
        where: { id: job.id },
        data: {
          status: "BLOCKED",
          errorCode: "CONNECTOR_BLOCKED",
          errorSummary: "搜索能力未核验",
        },
      });
      continue;
    }
    // 搜索也可能付费，不在进程重启后盲目重新发起未知搜索。
    if (job.status === "RUNNING") {
      await prisma.svDiscoveryJob.update({
        where: { id: job.id },
        data: {
          status: "BLOCKED",
          errorCode: "SEARCH_UNKNOWN",
          errorSummary: "原搜索未保存结果，需核实后明确创建新任务",
        },
      });
      continue;
    }
    if (
      !(
        await prisma.svDiscoveryJob.updateMany({
          where: { id: job.id, status: "PENDING" },
          data: { status: "RUNNING" },
        })
      ).count
    )
      continue;
    try {
      const result = DiscoveryResultZ.parse(
        await connector.search(
          { keywords: job.keywords as string[] },
          { userId: job.userId }
        )
      );
      await prisma.$transaction(async (tx) => {
        await userLock(tx, job.userId);
        const ids = [];
        for (const item of result.items) {
          const canonical = canonicalSource(
            job.platform,
            item.url,
            item.summary
          );
          const source = await tx.svSource.upsert({
            where: {
              userId_platform_canonicalKey: {
                userId: job.userId,
                platform: job.platform,
                canonicalKey: item.externalId
                  ? `external:${stableHash(item.externalId)}`
                  : canonical.canonicalKey,
              },
            },
            update: {},
            create: {
              userId: job.userId,
              platform: job.platform,
              ...canonical,
              ...(item.externalId
                ? {
                    canonicalKey: `external:${stableHash(item.externalId)}`,
                    externalId: item.externalId,
                  }
                : {}),
              title: item.title,
              summary: item.summary,
              authorDisplay: item.authorDisplay,
              observedAt: new Date(item.observedAt),
              publishedAt: item.publishedAt
                ? new Date(item.publishedAt)
                : undefined,
              metrics: item.metrics ? json(item.metrics) : undefined,
              ingestionMode: "CONNECTOR",
              connectorId: job.connectorId,
            },
          });
          ids.push(source.id);
        }
        await tx.svDiscoveryJob.update({
          where: { id: job.id },
          data: { status: "COMPLETED", resultSourceIds: ids },
        });
      });
    } catch {
      await prisma.svDiscoveryJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorCode: "SEARCH_FAILED",
          errorSummary: "搜索结果未取得或未通过校验，未伪造来源",
        },
      });
    }
  }
}
