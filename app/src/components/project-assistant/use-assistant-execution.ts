"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssistantExecutionOptions,
  AssistantExecutionSnapshot,
} from "@/lib/assistant-execution";

interface ExecutionResponse {
  execution: AssistantExecutionSnapshot | null;
}
class ExecutionError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}
async function readExecution(response: Response): Promise<ExecutionResponse> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ExecutionError(
      typeof body.error === "string"
        ? body.error
        : "暂时无法读取制作任务，请刷新查看",
      response.status
    );
  return body;
}
export function useAssistantExecution(projectId: string) {
  const client = useQueryClient();
  const queryKey = ["assistant-execution", projectId];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const requests = useRef(new Map<string, string>());
  useEffect(() => {
    const current = new AbortController();
    lifetime.current = current;
    return () => current.abort();
  }, []);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetch(
        `/api/assistant/executions?projectId=${encodeURIComponent(projectId)}`,
        { signal }
      ).then(readExecution),
    staleTime: 0,
    gcTime: 0,
    retry: (count, err) =>
      count < 2 && (!(err instanceof ExecutionError) || err.status >= 500),
    refetchInterval: (state) => {
      if (
        state.state.error instanceof ExecutionError &&
        [401, 403, 404].includes(state.state.error.status)
      )
        return false;
      return ["running", "stopping"].includes(
        state.state.data?.execution?.status ?? ""
      )
        ? 2000
        : false;
    },
  });
  const execution = query.data?.execution ?? null;
  useEffect(() => {
    if (!execution || execution.status === "planned") return;
    void client.invalidateQueries({ queryKey: ["project", projectId] });
    void client.invalidateQueries({ queryKey: ["projects"] });
    void client.invalidateQueries({ queryKey: ["credits"] });
  }, [client, projectId, execution]);

  async function submit(
    operation: "plan" | "confirm" | "resume" | "stop",
    options?: AssistantExecutionOptions
  ) {
    const signal = lifetime.current?.signal;
    if (lock.current || !signal || signal.aborted) return;
    if (operation !== "plan" && !execution) return;
    lock.current = true;
    setPending(true);
    setError("");
    const signature = JSON.stringify({
      operation,
      projectId,
      id: operation === "plan" ? undefined : execution?.id,
      options,
    });
    let requestId = requests.current.get(signature);
    if (!requestId) {
      requestId = crypto.randomUUID();
      requests.current.set(signature, requestId);
    }
    try {
      const result = await readExecution(
        await fetch(
          operation === "plan"
            ? "/api/assistant/executions"
            : `/api/assistant/executions/${execution!.id}`,
          {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              operation === "plan"
                ? { projectId, requestId, options }
                : { action: operation, requestId }
            ),
          }
        )
      );
      if (signal.aborted) return;
      client.setQueryData(queryKey, result);
      requests.current.delete(signature);
      setConflict(false);
      return true;
    } catch (err) {
      if (signal.aborted) return;
      setConflict(
        operation === "confirm" &&
          err instanceof ExecutionError &&
          err.status === 409
      );
      setError(
        err instanceof Error
          ? err.message
          : "请求未完成，请刷新任务确认状态后再试"
      );
      // 网络中断不能证明后台已停止；重新读取持久状态，再由用户决定后续动作。
      void query.refetch();
      return false;
    } finally {
      lock.current = false;
      if (!signal.aborted) setPending(false);
    }
  }
  return {
    execution,
    loading: query.isPending,
    pending,
    error,
    conflict,
    pollError: query.error,
    refresh: () => void query.refetch(),
    createPlan: (options: AssistantExecutionOptions) => submit("plan", options),
    confirm: () => submit("confirm"),
    resume: () => submit("resume"),
    stop: () => submit("stop"),
  };
}
