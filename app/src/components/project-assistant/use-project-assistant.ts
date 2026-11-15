"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AssistantTarget =
  | { projectId: string; seriesId?: never }
  | { seriesId: string; projectId?: never };
export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
interface AssistantMemory {
  content: string;
  version: number;
}
interface AssistantSnapshot {
  scope: {
    key: string;
    type: string;
    id: string;
    title: string;
    projectId?: string;
  };
  messages: AssistantMessage[];
  memory: AssistantMemory;
  busy?: boolean;
  hasMore?: boolean;
  context?: { sources: string[]; truncated: boolean };
}

class AssistantError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}
async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new AssistantError(
      typeof body.error === "string"
        ? body.error
        : body.error?.message || "助手暂时不可用，请稍后重试",
      response.status
    );
  return body as T;
}

export function useProjectAssistant(target: AssistantTarget) {
  const scopeId = target.projectId ?? target.seriesId;
  const scopeType = target.projectId ? "projectId" : "seriesId";
  const query = `${scopeType}=${encodeURIComponent(scopeId)}`;
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryConflict, setMemoryConflict] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const retry = useRef<{ signature: string; requestId: string } | null>(null);
  const bodyScope = { [scopeType]: scopeId };

  const load = useCallback(
    async (signal: AbortSignal, replaceMemory = true) => {
      try {
        const result = await readResponse<AssistantSnapshot>(
          await fetch(`/api/assistant?${query}`, { signal })
        );
        if (signal.aborted) return;
        setSnapshot(result);
        if (replaceMemory) {
          setMemoryDraft(result.memory.content);
          setMemoryConflict(false);
        }
      } catch (err) {
        if (!signal.aborted)
          setError(err instanceof Error ? err.message : "加载助手失败");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [query]
  );

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    void fetch(`/api/assistant?${query}`, { signal: current.signal })
      .then(readResponse<AssistantSnapshot>)
      .then((result) => {
        if (current.signal.aborted) return;
        setSnapshot(result);
        setMemoryDraft(result.memory.content);
        setMemoryConflict(false);
      })
      .catch((err) => {
        if (!current.signal.aborted)
          setError(err instanceof Error ? err.message : "加载助手失败");
      })
      .finally(() => {
        if (!current.signal.aborted) setLoading(false);
      });
    return () => current.abort();
  }, [query]);

  async function send(content: string, configId?: string, model?: string) {
    const signal = controller.current?.signal;
    if (
      !signal ||
      signal.aborted ||
      sending.current ||
      !snapshot ||
      content.trim().length === 0 ||
      content.length > 4000
    )
      return false;
    // 网络失败后复用同一次提问的 ID，避免重试重复保存或再次调用模型。
    model = model?.trim() || undefined;
    const signature = JSON.stringify({ content, configId, model });
    if (retry.current?.signature !== signature)
      retry.current = { signature, requestId: crypto.randomUUID() };
    sending.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await readResponse<AssistantSnapshot>(
        await fetch("/api/assistant/messages", {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...bodyScope,
            content,
            configId,
            model,
            requestId: retry.current.requestId,
          }),
        })
      );
      if (signal.aborted) return false;
      setSnapshot(result);
      retry.current = null;
      return true;
    } catch (err) {
      if (!signal.aborted)
        setError(err instanceof Error ? err.message : "发送失败，请重试");
      return false;
    } finally {
      sending.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  async function saveMemory() {
    const signal = controller.current?.signal;
    if (
      !snapshot ||
      !signal ||
      signal.aborted ||
      sending.current ||
      memoryDraft.length > 12000
    )
      return;
    sending.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await readResponse<{ memory: AssistantMemory }>(
        await fetch("/api/assistant/memory", {
          method: "PATCH",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...bodyScope,
            content: memoryDraft,
            version: snapshot.memory.version,
          }),
        })
      );
      if (signal.aborted) return;
      setSnapshot((prev) => (prev ? { ...prev, memory: result.memory } : prev));
      setMemoryDraft(result.memory.content);
      setMemoryConflict(false);
      setNotice("记忆已保存");
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof AssistantError && err.status === 409) {
        setMemoryConflict(true);
        setError(
          "其他页面已更新记忆。草稿已保留，请复制需要的内容，再载入最新记忆进行合并。"
        );
      } else setError(err instanceof Error ? err.message : "保存记忆失败");
    } finally {
      sending.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  async function clearMessages() {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || sending.current) return;
    sending.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await readResponse(
        await fetch(`/api/assistant/messages?${query}`, {
          method: "DELETE",
          signal,
        })
      );
      if (signal.aborted) return;
      setSnapshot((prev) =>
        prev ? { ...prev, messages: [], hasMore: false } : prev
      );
      retry.current = null;
      setNotice("聊天已清空，剧集记忆已保留");
    } catch (err) {
      if (!signal.aborted)
        setError(err instanceof Error ? err.message : "清空聊天失败");
    } finally {
      sending.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  return {
    snapshot,
    loading,
    pending,
    error,
    notice,
    memoryDraft,
    setMemoryDraft,
    memoryConflict,
    send,
    saveMemory,
    clearMessages,
    reload: () => {
      if (controller.current) {
        setLoading(true);
        setError("");
        void load(controller.current.signal);
      }
    },
    refreshChat: () => {
      if (controller.current) {
        setLoading(true);
        setError("");
        void load(controller.current.signal, false);
      }
    },
  };
}
