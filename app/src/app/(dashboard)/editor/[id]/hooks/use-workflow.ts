"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { WorkflowStatus, WorkflowEvent } from "@/services/agents/types";

interface UseWorkflowReturn {
  /** 当前 workflow 状态 */
  status: WorkflowStatus | null;
  /** 实时事件日志 */
  events: WorkflowEvent[];
  /** 是否正在运行 */
  isRunning: boolean;
  /** 启动 workflow */
  start: (text: string, options?: WorkflowStartOptions) => Promise<void>;
  /** 取消 workflow */
  cancel: () => Promise<void>;
  /** 错误信息 */
  error: string | null;
}

interface WorkflowStartOptions {
  mode?: "auto" | "step_by_step";
  maxImageReflectionRounds?: number;
  style?: string;
}

export function useWorkflow(projectId: string): UseWorkflowReturn {
  const [status, setStatus] = useState<WorkflowStatus | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const workflowIdRef = useRef<string | null>(null);

  // 清理 SSE 连接
  const closeSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => closeSSE, [closeSSE]);

  // 订阅 SSE 事件
  const subscribeEvents = useCallback(
    (workflowRunId: string) => {
      closeSSE();

      const es = new EventSource(`/api/workflow/${workflowRunId}/events`);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as WorkflowEvent;
          setEvents((prev) => [...prev, event]);

          if (event.type === "workflow:completed") {
            setIsRunning(false);
            closeSSE();
            // 获取最终状态
            fetchStatus(workflowRunId);
          } else if (event.type === "workflow:failed") {
            setIsRunning(false);
            setError((event.data as { error?: string }).error ?? "Workflow 执行失败");
            closeSSE();
            fetchStatus(workflowRunId);
          }
        } catch {
          // 忽略解析错误（如心跳）
        }
      };

      es.onerror = () => {
        // SSE 连接断开，尝试轮询获取最终状态
        closeSSE();
        if (workflowIdRef.current) {
          fetchStatus(workflowIdRef.current);
        }
      };
    },
    [closeSSE],
  );

  const fetchStatus = async (workflowRunId: string) => {
    try {
      const res = await fetch(`/api/workflow/${workflowRunId}`);
      if (res.ok) {
        const data = (await res.json()) as WorkflowStatus;
        setStatus(data);
        if (data.status === "COMPLETED" || data.status === "FAILED") {
          setIsRunning(false);
        }
      }
    } catch {
      // 静默失败
    }
  };

  const start = useCallback(
    async (text: string, options?: WorkflowStartOptions) => {
      setError(null);
      setEvents([]);
      setStatus(null);
      setIsRunning(true);

      try {
        const res = await fetch("/api/workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            text,
            mode: options?.mode ?? "auto",
            maxImageReflectionRounds: options?.maxImageReflectionRounds ?? 2,
            style: options?.style ?? "anime",
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "启动失败");
        }

        const { id } = (await res.json()) as { id: string };
        workflowIdRef.current = id;

        // 订阅实时事件
        subscribeEvents(id);

        // 获取初始状态
        await fetchStatus(id);
      } catch (err) {
        setIsRunning(false);
        setError(err instanceof Error ? err.message : "启动 workflow 失败");
      }
    },
    [projectId, subscribeEvents],
  );

  const cancel = useCallback(async () => {
    if (!workflowIdRef.current) return;

    try {
      await fetch(`/api/workflow/${workflowIdRef.current}`, { method: "DELETE" });
      setIsRunning(false);
      closeSSE();
    } catch {
      // 静默
    }
  }, [closeSSE]);

  return { status, events, isRunning, start, cancel, error };
}
