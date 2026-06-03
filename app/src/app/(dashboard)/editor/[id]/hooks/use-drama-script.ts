"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DramaScriptArtifact,
  DramaScriptInput,
  StoryboardCell,
  StoryboardTableArtifact,
} from "@/types";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 90; // 90 × 2s = 3 分钟上限

/** 短剧脚本记录（含 DB 元字段 + scriptDoc 主体） */
export interface ShortDramaScriptRecord {
  id: string;
  projectId: string;
  filmTitle: string | null;
  genre: string | null;
  durationSec: number;
  aspectRatio: string;
  style: string;
  protagonist: string | null;
  worldview: string | null;
  scriptDoc: DramaScriptArtifact | Record<string, unknown>;
  storyboard: unknown;
  gridImageUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 触发「世界观→结构化脚本」生成：POST 拿 taskId → 复用 /api/script/parse/[taskId] 轮询。
 * 返回 task.output（含 scriptId + DramaScriptArtifact 字段）。
 */
async function generateDramaScript(
  projectId: string,
  input: DramaScriptInput
): Promise<{ scriptId: string } & DramaScriptArtifact> {
  const startRes = await fetch(`/api/projects/${projectId}/drama-script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err?.error ?? `生成失败 (HTTP ${startRes.status})`);
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`/api/script/parse/${taskId}`);
    if (!pollRes.ok) {
      const err = await pollRes.json().catch(() => ({}));
      throw new Error(err?.error ?? `轮询失败 (HTTP ${pollRes.status})`);
    }
    const data = (await pollRes.json()) as {
      status: string;
      result?: { scriptId: string } & DramaScriptArtifact;
      error?: string;
    };
    if (data.status === "COMPLETED" && data.result) {
      return data.result;
    }
    if (data.status === "FAILED") {
      throw new Error(data.error ?? "短剧脚本生成失败");
    }
  }
  throw new Error("生成超时，请稍后在脚本列表中查看");
}

/** 通用 task 轮询（复用 /api/script/parse/[taskId]，所有创作链 task 均 SCRIPT_PARSE 类型） */
async function pollTask<T>(startUrl: string, body?: unknown): Promise<T> {
  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err?.error ?? `请求失败 (HTTP ${startRes.status})`);
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`/api/script/parse/${taskId}`);
    if (!pollRes.ok) {
      const err = await pollRes.json().catch(() => ({}));
      throw new Error(err?.error ?? `轮询失败 (HTTP ${pollRes.status})`);
    }
    const data = (await pollRes.json()) as {
      status: string;
      result?: T;
      error?: string;
    };
    if (data.status === "COMPLETED" && data.result) return data.result;
    if (data.status === "FAILED") throw new Error(data.error ?? "生成失败");
  }
  throw new Error("生成超时，请稍后刷新查看");
}

/** 短剧脚本创作 hook：生成 + 列表查询 + 打磨更新 + 九宫格分镜表 + 九宫格图 */
export function useDramaScript(projectId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["drama-script", projectId];

  const listQuery = useQuery<{ scripts: ShortDramaScriptRecord[] }>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/drama-script`);
      if (!res.ok) throw new Error("获取脚本列表失败");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: (input: DramaScriptInput) =>
      generateDramaScript(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (args: {
      scriptId: string;
      data: Partial<ShortDramaScriptRecord>;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/drama-script/${args.scriptId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.data),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "更新失败");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // 阶段2：生成九宫格分镜表（消费已生成的脚本）
  const generateStoryboardMutation = useMutation({
    mutationFn: (scriptId: string) =>
      pollTask<StoryboardTableArtifact & { scriptId: string }>(
        `/api/projects/${projectId}/drama-script/${scriptId}/storyboard`
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // 阶段2：逐格打磨分镜表（提交完整 9 格）
  const updateStoryboardMutation = useMutation({
    mutationFn: async (args: { scriptId: string; cells: StoryboardCell[] }) => {
      const res = await fetch(
        `/api/projects/${projectId}/drama-script/${args.scriptId}/storyboard`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyboard: { cells: args.cells } }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "更新失败");
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // 阶段3：一键生成九宫格合成图（扣积分，复用 generate 流程同步返回）
  const generateGridImageMutation = useMutation({
    mutationFn: async (args: { scriptId: string; imageConfigId?: string }) => {
      const res = await fetch(
        `/api/projects/${projectId}/drama-script/${args.scriptId}/grid-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageConfigId: args.imageConfigId }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "生成九宫格图失败");
      }
      return res.json() as Promise<{ gridImageUrl: string; cost: number }>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    scripts: listQuery.data?.scripts ?? [],
    isLoading: listQuery.isLoading,
    generateMutation,
    updateMutation,
    generateStoryboardMutation,
    updateStoryboardMutation,
    generateGridImageMutation,
  };
}
