export interface AssistantToolOptions {
  imageConfigId?: string;
  videoConfigId?: string;
  llmConfigId?: string;
}
export interface AssistantActionInput {
  userId: string;
  projectId: string;
  runId: string;
  operationKey: string;
  kind:
    | "prepare"
    | "location"
    | "image"
    | "inspect"
    | "repair"
    | "links"
    | "video";
  targetId?: string;
  note?: string;
  anchorSceneId?: string;
  maxCost: number;
  options: AssistantToolOptions;
  onTaskCreated?: (taskId: string) => Promise<void>;
}
export interface AssistantActionResult {
  taskId?: string;
  actualCost: number;
  issues?: Array<{ sceneId: string; note: string; anchorSceneId?: string }>;
  artifact?: unknown;
  requiresReview?: boolean;
}
export interface AssistantActionReconciliation {
  status: "not_started" | "processing" | "completed" | "failed" | "unknown";
  taskId?: string;
  result?: AssistantActionResult;
  error?: string;
}
