import { prisma } from "@/lib/prisma";
import { MetricZ, RequestZ } from "@/lib/short-video/contracts";
import { invariant } from "@/lib/short-video/errors";
import { receipt, page, pageArgs } from "./store";
import { ownedPublication } from "./publications";
export async function addMetric(
  userId: string,
  publicationId: string,
  raw: unknown
) {
  const input = RequestZ.extend(MetricZ.shape).strict().parse(raw);
  const ref = await receipt(
    userId,
    `metric:${publicationId}`,
    input,
    async (tx) => {
      const publication = await ownedPublication(userId, publicationId, tx);
      invariant(
        publication.publishedAt && publication.status === "PUBLISHED",
        409,
        "NOT_PUBLISHED",
        "请先登记真实发布结果"
      );
      const at = new Date(input.observedAt);
      invariant(
        at >= publication.publishedAt && at <= new Date(),
        422,
        "METRIC_TIME",
        "指标采集时间须在发布后且不晚于现在"
      );
      const row = await tx.svMetricSnapshot.create({
        data: {
          userId,
          publicationId,
          observedAt: at,
          windowLabel: input.windowLabel,
          source: "MANUAL",
          ...input.metrics,
        },
      });
      return { id: row.id };
    }
  );
  return prisma.svMetricSnapshot.findFirstOrThrow({
    where: { id: ref.id, userId },
  });
}
export async function listMetrics(
  userId: string,
  publicationId: string,
  params: Record<string, unknown>
) {
  await ownedPublication(userId, publicationId);
  const args = pageArgs(params);
  return page(
    await prisma.svMetricSnapshot.findMany({
      ...args,
      where: { ...args.where, userId, publicationId },
    }),
    args.take
  );
}
