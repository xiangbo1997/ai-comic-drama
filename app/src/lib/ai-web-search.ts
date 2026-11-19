import { z } from "zod";

export function webSearchTransport(extra: unknown): "off" | "responses" {
  return extra &&
    typeof extra === "object" &&
    "webSearchTransport" in extra &&
    extra.webSearchTransport === "responses"
    ? "responses"
    : "off";
}
export function validWebSearchSetting(extra: unknown) {
  if (
    extra &&
    typeof extra === "object" &&
    "webSearchReasoningEffort" in extra &&
    !["auto", "low", "medium", "high"].includes(
      String(extra.webSearchReasoningEffort)
    )
  )
    return false;
  if (!extra || typeof extra !== "object" || !("webSearchTransport" in extra))
    return true;
  return (
    extra.webSearchTransport === "off" ||
    extra.webSearchTransport === "responses"
  );
}
export const WebSearchResultZ = z.object({
  answer: z.string().min(1).max(24000),
  responseId: z.string().max(256).nullable(),
  model: z.string().min(1).max(255),
  retrievedAt: z.iso.datetime(),
  toolCalls: z.number().int().positive(),
  sources: z
    .array(
      z.object({
        title: z.string().max(500),
        url: z
          .url()
          .max(2048)
          .refine((s) => /^https:\/\//i.test(s)),
      })
    )
    .min(1)
    .max(100),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  }),
});
export type WebSearchResult = z.infer<typeof WebSearchResultZ>;
export function searchConfigurationVerified(config: {
  testStatus: string | null;
  lastTestedAt: Date | null;
  provider: { updatedAt: Date };
}) {
  return (
    config.testStatus === "SUCCESS" &&
    !!config.lastTestedAt &&
    config.lastTestedAt.getTime() >= config.provider.updatedAt.getTime()
  );
}
