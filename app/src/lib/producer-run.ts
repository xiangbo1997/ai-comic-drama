import { z } from "zod";
import type { DramaScriptArtifact } from "@/types";

export const PRODUCER_STEPS = [
  "worldview",
  "project",
  "script",
  "characters",
  "scenes",
] as const;
export type ProducerStep = (typeof PRODUCER_STEPS)[number];
export const ProducerSettingsZ = z.object({
  idea: z.string().trim().min(1).max(10000),
  style: z.string().trim().min(1).max(50),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  durationSec: z.number().int().min(10).max(600),
  genre: z.string().trim().max(100).default(""),
});
export type ProducerSettings = z.infer<typeof ProducerSettingsZ>;
export const WorldviewDraftZ = z.object({
  worldview: z.string().trim().min(1).max(50000),
  protagonist: z.string().trim().max(5000),
  genre: z.string().trim().max(100),
  filmTitle: z.string().trim().min(1).max(200),
});
export const ProducerActionZ = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), token: z.string().min(1).max(128) }),
  z.object({
    action: z.literal("heartbeat"),
    token: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("release"),
    token: z.string().min(1).max(128),
    error: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("worldview"),
    token: z.string().min(1).max(128),
    draft: WorldviewDraftZ,
  }),
  z.object({ action: z.literal("project"), token: z.string().min(1).max(128) }),
  z.object({
    action: z.literal("script"),
    token: z.string().min(1).max(128),
    scriptId: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("roster"),
    token: z.string().min(1).max(128),
    roster: z
      .array(
        z.object({
          name: z.string().max(100),
          gender: z.string().max(100),
          age: z.string().max(100),
          description: z.string().max(5000),
        })
      )
      .max(50),
  }),
  z.object({
    action: z.literal("character"),
    token: z.string().min(1).max(128),
    name: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("characters"),
    token: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("finalize"),
    token: z.string().min(1).max(128),
  }),
]);
export type ProducerAction = z.infer<typeof ProducerActionZ>;
export interface ProducerRunState {
  version: number;
  status: "paused" | "running" | "failed" | "completed";
  completedSteps: ProducerStep[];
  worldviewDraft?: z.infer<typeof WorldviewDraftZ>;
  scriptId?: string;
  artifact?: DramaScriptArtifact;
  roster?: Array<{
    name: string;
    gender: string;
    age: string;
    description: string;
  }>;
  createdCharNames: string[];
  lease: { token: string; expiresAt: number } | null;
  error: string | null;
}
export interface ProducerRunSnapshot extends Omit<ProducerRunState, "lease"> {
  id: string;
  projectId: string | null;
  settings: ProducerSettings;
  leaseExpiresAt: number | null;
}
