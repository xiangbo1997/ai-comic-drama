import { z } from "zod";
import { SocialPlatformZ, ScriptZ } from "./contracts";
export const HOT_BRIEF_CONNECTOR = "public-hot-brief-v1";
export const HotInputZ = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .default("搜索一下有啥最新的梗可以做成抽象视频吗"),
    platforms: z
      .array(SocialPlatformZ)
      .min(1)
      .max(3)
      .transform((v) => [...new Set(v)])
      .default(["DOUYIN", "KUAISHOU", "XIAOHONGSHU"]),
    style: z.enum(["XIANXIA", "ANIMALS", "DAILY"]).default("XIANXIA"),
    windowDays: z.number().int().min(1).max(7).default(3),
  })
  .strict();
export const HotRequestZ = HotInputZ.extend({ requestId: z.uuid() });
export type HotInput = z.infer<typeof HotInputZ>;
export type HotPlatform = z.infer<typeof SocialPlatformZ>;
export const HotTopicZ = z.object({
  id: z.string(),
  platform: SocialPlatformZ,
  title: z.string().min(1).max(200),
  url: z.url(),
  sourceName: z.string(),
  sourceUrl: z.url(),
  evidenceKind: z.enum(["PUBLIC_BOARD", "AGGREGATE_BOARD", "WEB_SEARCH"]),
  rank: z.number().int().positive().nullable(),
  heat: z.number().nonnegative().nullable(),
  heatLabel: z.string().nullable(),
  fetchedAt: z.iso.datetime(),
  snapshotAt: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  timeBasis: z.enum(["SOURCE_TEXT", "RELATIVE", "UNKNOWN"]),
  snippet: z.string().max(1000),
});
export type HotTopic = z.infer<typeof HotTopicZ>;
export const HotBoardZ = z.object({
  platform: SocialPlatformZ,
  status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
  items: z.array(HotTopicZ).max(100),
  fetchedAt: z.iso.datetime(),
  sourceUrl: z.url().nullable(),
  reason: z.string().nullable(),
});
export type HotBoard = z.infer<typeof HotBoardZ>;
export const HotIdeaZ = z.object({
  id: z.string(),
  topicId: z.string(),
  title: z.string(),
  category: z.enum(["RELAX", "ANIMAL", "FOOD", "WORK", "DAILY"]),
  outline: z.string(),
  rationale: z.string(),
  firstFrame: z.string(),
  difficulty: z.literal("低"),
  durationSec: z.number().int(),
  script: ScriptZ,
});
export type HotIdea = z.infer<typeof HotIdeaZ>;
export const HotReportZ = z.object({
  schemaVersion: z.literal(1),
  query: z.string(),
  style: z.enum(["XIANXIA", "ANIMALS", "DAILY"]),
  generatedAt: z.iso.datetime(),
  summary: z.string(),
  sources: z.array(HotBoardZ).max(3),
  topics: z.array(HotTopicZ).max(300),
  ideas: z.array(HotIdeaZ).max(8),
  recommendation: z.string().nullable(),
  notes: z.array(z.string()),
});
export type HotReport = z.infer<typeof HotReportZ>;
