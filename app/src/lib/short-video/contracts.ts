import { z } from "zod";
export const PlatformZ = z.enum(["DOUYIN", "KUAISHOU", "XIAOHONGSHU", "OTHER"]);
export const SocialPlatformZ = PlatformZ.exclude(["OTHER"]);
const id = z.string().min(1).max(100);
const text = (max: number) => z.string().trim().max(max);
export const RequestZ = z.object({ requestId: z.uuid() });
export const VersionZ = RequestZ.extend({
  expectedVersion: z.number().int().positive(),
});
export const ScriptZ = z
  .object({
    schemaVersion: z.literal(1),
    title: text(80).min(1),
    hook: text(500).min(1),
    premise: text(1000).min(1),
    targetDurationSec: z.number().int().min(15).max(30),
    aspectRatio: z.literal("9:16"),
    characters: z
      .array(
        z
          .object({
            key: id,
            name: text(80).min(1),
            appearance: text(1000).min(1),
          })
          .strict()
      )
      .max(10),
    shots: z
      .array(
        z
          .object({
            key: id,
            durationSec: z.number().int().min(1).max(15),
            description: text(3000).min(1),
            imagePrompt: text(3000).min(1),
            videoPrompt: text(3000).min(1),
            dialogue: text(500),
            narration: text(500),
            subtitle: text(1000),
            characterKeys: z.array(id).max(10),
          })
          .strict()
      )
      .min(1)
      .max(5),
    ending: text(1000),
    suggestedCaption: text(2000),
    hashtags: z.array(text(80).min(1)).max(10),
  })
  .strict()
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (s.shots.reduce((n, x) => n + x.durationSec, 0) !== s.targetDurationSec)
      fail("镜头时长之和必须等于目标时长");
    if (
      new Set(s.shots.map((x) => x.key)).size !== s.shots.length ||
      new Set(s.characters.map((x) => x.key)).size !== s.characters.length
    )
      fail("镜头及角色 key 必须唯一");
    if (
      s.shots.some((x) =>
        x.characterKeys.some((k) => !s.characters.some((c) => c.key === k))
      )
    )
      fail("引用的角色不存在");
  });
export type SvScript = z.infer<typeof ScriptZ>;
export const SourceZ = RequestZ.extend({
  platform: PlatformZ,
  url: z.url().max(2048).optional(),
  summary: text(4000).min(1),
  title: text(200).optional(),
  rightsNote: text(1000).optional(),
}).strict();
export const VideoZ = RequestZ.extend({
  title: text(80).min(1),
  brief: text(4000),
  sourceIds: z.array(id).max(20).default([]),
  templateId: id.optional(),
}).strict();
export const VideoPatchZ = VersionZ.extend({
  title: text(80).min(1).optional(),
  brief: text(4000).optional(),
  archived: z.boolean().optional(),
}).strict();
export const TemplateFieldsZ = z.object({
  name: text(80).min(1),
  description: text(1000),
  systemInstructions: text(8000).min(1),
  characterPreset: z.record(z.string(), z.string().max(1000)).default({}),
  stylePreset: z.record(z.string(), z.string().max(1000)).default({}),
  enabled: z.boolean().default(true),
});
export const ScriptSaveZ = RequestZ.extend({
  expectedVideoVersion: z.number().int().positive(),
  content: ScriptZ,
}).strict();
export const ScriptRunZ = RequestZ.extend({
  llmConfigId: id,
  templateVersion: z.number().int().positive(),
  expectedVideoVersion: z.number().int().positive(),
}).strict();
export const RenderPlanZ = RequestZ.extend({
  scriptVersionId: id,
  modelConfigIds: z
    .object({ image: id, video: id, tts: id.nullable().optional() })
    .strict(),
  maxCredits: z.number().int().min(0).max(100000),
  ttsEnabled: z.boolean(),
}).strict();
export const RunActionZ = VersionZ.extend({
  action: z.enum(["confirm", "stop", "resume", "reconcile"]),
  planHash: z.string().length(64).optional(),
}).strict();
export const PublicationPayloadZ = z
  .object({
    title: text(80).min(1),
    text: text(4000),
    hashtags: z.array(text(80).min(1)).max(10),
    coverArtifactId: id.nullable().default(null),
    aiGenerated: z.boolean(),
    commercial: z.boolean(),
    platformFields: z.object({}).strict().default({}),
  })
  .strict();
export const PublicationZ = RequestZ.extend({
  videoId: id,
  accountId: id,
  artifactId: id,
  payload: PublicationPayloadZ,
  mode: z.enum(["MANUAL", "AUTO"]),
}).strict();
export const PublicationPatchZ = VersionZ.extend({
  payload: PublicationPayloadZ.optional(),
  artifactId: id.optional(),
}).strict();
export const TimeZoneZ = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "时区必须为有效 IANA 名称");
export const PublicationActionZ = VersionZ.extend({
  action: z.enum([
    "approve",
    "schedule",
    "cancel",
    "reconcile",
    "mark_manual_published",
  ]),
  approvedHash: z.string().length(64).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  timeZone: TimeZoneZ.optional(),
  externalUrl: z.url().max(2048).optional(),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
}).strict();
export const AccountZ = RequestZ.extend({
  platform: SocialPlatformZ,
  displayName: text(100).min(1),
  mode: z.literal("MANUAL"),
}).strict();
const count = z.number().int().min(0).max(2147483647).nullable().default(null);
export const MetricZ = z
  .object({
    observedAt: z.iso.datetime({ offset: true }),
    windowLabel: z.enum(["H24", "H72", "CUSTOM"]),
    metrics: z
      .object({
        views: count,
        likes: count,
        comments: count,
        shares: count,
        saves: count,
        attributedFollowers: count,
        completionRate: z.number().min(0).max(1).nullable().default(null),
        avgWatchMs: count,
      })
      .strict(),
  })
  .strict();
export const DiscoveryZ = RequestZ.extend({
  platform: SocialPlatformZ,
  connectorId: id,
  keywords: z.array(text(80).min(1)).min(1).max(5),
}).strict();
export const PageZ = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
