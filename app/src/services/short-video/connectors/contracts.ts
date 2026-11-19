import { z } from "zod";
import {
  SocialPlatformZ,
  PublicationPayloadZ,
} from "@/lib/short-video/contracts";
export const CapabilityZ = z
  .object({
    platform: SocialPlatformZ,
    connectorId: z.string(),
    discovery: z.enum(["UNAVAILABLE", "MANUAL", "VERIFIED"]),
    publish: z.enum(["UNAVAILABLE", "MANUAL", "VERIFIED"]),
    metrics: z.enum(["UNAVAILABLE", "MANUAL", "VERIFIED"]),
    mode: z.enum(["OFFICIAL_API", "BROWSER", "MANUAL"]),
    supportsSubmissionLookup: z.boolean(),
    supportsIdempotencyKey: z.boolean(),
    verifiedAt: z.iso.datetime().nullable(),
    reason: z.string().nullable(),
  })
  .strict();
export type Capability = z.infer<typeof CapabilityZ>;
export const DiscoveryResultZ = z
  .object({
    items: z
      .array(
        z
          .object({
            externalId: z.string().optional(),
            url: z.url(),
            title: z.string().max(200),
            summary: z.string().min(1).max(4000),
            authorDisplay: z.string().max(200).optional(),
            observedAt: z.iso.datetime(),
            publishedAt: z.iso.datetime().optional(),
            metrics: z
              .record(z.string(), z.number().nonnegative().nullable())
              .optional(),
          })
          .strict()
      )
      .max(50),
  })
  .strict();
export const SubmitResultZ = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("accepted"), submissionId: z.string().min(1) })
    .strict(),
  z
    .object({
      status: z.literal("known_rejected"),
      reasonCode: z.string().max(100),
    })
    .strict(),
  z.object({ status: z.literal("unknown") }).strict(),
]);
export const ReconcileResultZ = z
  .object({
    status: z.enum([
      "processing",
      "published",
      "rejected",
      "not_submitted",
      "unknown",
    ]),
    postId: z.string().optional(),
    url: z.url().optional(),
    publishedAt: z.iso.datetime().optional(),
  })
  .strict()
  .refine(
    (v) => v.status !== "published" || !!(v.postId && v.url && v.publishedAt),
    "公开成功必须有作品凭证"
  );
export type ConnectorContext = {
  userId: string;
  accountId?: string;
  signal?: AbortSignal;
};
export type PublicationSnapshot = {
  platform: z.infer<typeof SocialPlatformZ>;
  accountId: string;
  artifact: {
    storageKey: string;
    sha256: string;
    mimeType: string;
    bytes: string;
    durationMs: number | null;
    width: number | null;
    height: number | null;
  };
  payload: z.infer<typeof PublicationPayloadZ>;
};
export interface ShortVideoConnector {
  capability: Capability;
  search?: (
    query: { keywords: string[] },
    context: ConnectorContext
  ) => Promise<z.infer<typeof DiscoveryResultZ>>;
  validate?: (
    snapshot: PublicationSnapshot,
    context: ConnectorContext
  ) => Promise<{ valid: boolean; reason: string | null }>;
  submit?: (
    snapshot: PublicationSnapshot,
    operationKey: string,
    context: ConnectorContext
  ) => Promise<z.infer<typeof SubmitResultZ>>;
  reconcile?: (
    receipt: { operationKey: string; submissionId: string | null },
    context: ConnectorContext
  ) => Promise<z.infer<typeof ReconcileResultZ>>;
}
