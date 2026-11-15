import { z } from "zod";

export const AssistantExecutionOptionsZ = z
  .object({
    maxCredits: z.number().int().min(1).max(10000),
    maxRepairRounds: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .default(1),
    generateVideos: z.boolean().default(true),
    imageConfigId: z.string().min(1).max(255).optional(),
    videoConfigId: z.string().min(1).max(255).optional(),
    llmConfigId: z.string().min(1).max(255).optional(),
  })
  .strict();
export type AssistantExecutionOptions = z.infer<
  typeof AssistantExecutionOptionsZ
>;
export const CreateAssistantExecutionZ = z
  .object({
    projectId: z.string().min(1).max(100),
    requestId: z.uuid(),
    options: AssistantExecutionOptionsZ,
  })
  .strict();
export const AssistantExecutionActionZ = z
  .object({
    action: z.enum(["confirm", "resume", "stop"]),
    requestId: z.uuid(),
  })
  .strict();
export type AssistantExecutionStatus =
  | "planned"
  | "running"
  | "stopping"
  | "paused"
  | "completed"
  | "stopped"
  | "failed";
export type AssistantExecutionKind =
  | "prepare"
  | "location"
  | "image"
  | "inspect"
  | "repair"
  | "links"
  | "video";
export interface AssistantExecutionStep {
  id: string;
  kind: AssistantExecutionKind;
  label: string;
  targetId?: string;
  maxCredits: number;
  status:
    | "pending"
    | "running"
    | "completed"
    | "skipped"
    | "failed"
    | "unknown";
  taskId?: string;
  actualCredits?: number;
  error?: string;
  note?: string;
  anchorSceneId?: string;
}
export interface AssistantExecutionPlan {
  fingerprint: string;
  configFingerprint: string;
  assetFingerprint?: string;
  steps: Array<
    Pick<
      AssistantExecutionStep,
      "id" | "kind" | "label" | "targetId" | "maxCredits"
    >
  >;
  blockers: string[];
  estimatedCredits: number;
  models: { image: string; video: string; llm: string };
  warnings: string[];
  sceneIds: string[];
  imageMaxCost: number;
  baseCredits?: number;
  locationCost?: number;
  unlabeledLocationSlots?: number;
  locationKeys?: string[];
}
export interface AssistantExecutionSnapshot {
  id: string;
  projectId: string;
  status: AssistantExecutionStatus;
  version: number;
  plan: AssistantExecutionPlan;
  options: AssistantExecutionOptions;
  budget: { limit: number; spent: number; reserved: number };
  steps: AssistantExecutionStep[];
  repairRounds: number;
  currentStepId: string | null;
  error: string | null;
  requiresAttention: boolean;
  resumeBlocked?: boolean;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AssistantExecutionState extends Omit<
  AssistantExecutionSnapshot,
  "id" | "projectId" | "createdAt" | "updatedAt"
> {
  lease: { token: string; expiresAt: number } | null;
  reviewFingerprint?: string;
  controlRequests: Array<{
    requestId: string;
    action: "confirm" | "resume" | "stop";
  }>;
}
export class AssistantExecutionError extends Error {
  constructor(
    message: string,
    public readonly status = 409
  ) {
    super(message);
    this.name = "AssistantExecutionError";
  }
}
