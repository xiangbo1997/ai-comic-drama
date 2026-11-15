export class GenerationJobError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>
  ) {
    super(typeof body.error === "string" ? body.error : "生成任务失败");
  }
}

/** 仅供服务端执行器使用，HTTP请求体不能透传这些控制字段。 */
export interface InternalGenerationOptions {
  operationKey?: string;
  executionRunId?: string;
  maxCost?: number;
  disableRetries?: boolean;
  expectedSceneImageUrl?: string | null;
  expectedVideoUrl?: string | null;
  llmConfigId?: string;
  onTaskCreated?: (taskId: string) => Promise<void>;
}

export interface GenerationSubmission {
  taskId: string;
  cost: number;
}
