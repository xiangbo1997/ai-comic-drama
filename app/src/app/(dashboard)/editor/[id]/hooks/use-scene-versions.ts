"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SceneVersion } from "@/types";

/**
 * 分镜生成版本历史（迭代式图片生成）。
 *
 * - 拉取该分镜的所有历史版本（GET /api/scenes/[sceneId]/attempts）
 * - 支持把某历史版本设为当前（PATCH），回写 Scene.imageUrl 并刷新 project 缓存
 *
 * @param sceneId  分镜 ID；undefined 时不发起请求
 * @param projectId 所属项目 ID；切换版本成功后失效 project 缓存让 imageUrl 回写生效
 */
export function useSceneVersions(
  sceneId: string | undefined,
  projectId: string
) {
  const queryClient = useQueryClient();

  const versionsQuery = useQuery<{ attempts: SceneVersion[] }>({
    queryKey: ["scene-versions", sceneId],
    queryFn: async () => {
      const res = await fetch(`/api/scenes/${sceneId}/attempts`);
      if (!res.ok) throw new Error("获取版本历史失败");
      return res.json();
    },
    enabled: !!sceneId,
  });

  const setCurrentVersion = useMutation({
    mutationFn: async ({ attemptId }: { attemptId: string }) => {
      const res = await fetch(`/api/scenes/${sceneId}/attempts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || "切换版本失败");
      }
      return res.json() as Promise<{ imageUrl: string }>;
    },
    onSuccess: () => {
      // 版本列表（isCurrent 变化）+ project（imageUrl 回写）都需刷新
      queryClient.invalidateQueries({ queryKey: ["scene-versions", sceneId] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  return {
    versions: versionsQuery.data?.attempts ?? [],
    isLoading: versionsQuery.isLoading,
    setCurrentVersion,
  };
}
