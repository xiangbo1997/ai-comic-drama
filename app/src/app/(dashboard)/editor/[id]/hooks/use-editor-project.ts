"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Scene, Character, ProjectDetail } from "@/types";

// ============ API 函数 ============

async function fetchProject(id: string): Promise<ProjectDetail> {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) throw new Error("Failed to fetch project");
  return res.json();
}

async function apiUpdateProject(id: string, data: Partial<ProjectDetail>) {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update project");
  return res.json();
}

async function parseScript(text: string) {
  const res = await fetch("/api/script/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Failed to parse script");
  return res.json();
}

async function saveScenes(
  projectId: string,
  scenes: Record<string, unknown>[]
) {
  const res = await fetch(`/api/projects/${projectId}/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenes }),
  });
  if (!res.ok) throw new Error("Failed to save scenes");
  return res.json();
}

export async function apiUpdateScene(
  projectId: string,
  sceneId: string,
  data: Partial<Scene>
) {
  const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update scene");
  return res.json();
}

async function fetchAllCharacters(): Promise<Character[]> {
  const res = await fetch("/api/characters");
  if (!res.ok) throw new Error("Failed to fetch characters");
  return res.json();
}

async function updateProjectCharacters(
  projectId: string,
  characterIds: string[]
) {
  const res = await fetch(`/api/projects/${projectId}/characters`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterIds }),
  });
  if (!res.ok) throw new Error("Failed to update project characters");
  return res.json();
}

// ============ Hook ============

export function useEditorProject(projectId: string) {
  const queryClient = useQueryClient();

  const [inputText, setInputText] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [showCharacterManager, setShowCharacterManager] = useState(false);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(
    new Set()
  );

  const {
    data: project,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
    enabled: projectId !== "new",
  });

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: fetchAllCharacters,
    enabled: showCharacterManager,
  });

  const invalidateProject = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }, [queryClient, projectId]);

  // 更新项目角色关联
  const updateCharactersMutation = useMutation({
    mutationFn: (characterIds: string[]) =>
      updateProjectCharacters(projectId, characterIds),
    onSuccess: () => {
      invalidateProject();
      setShowCharacterManager(false);
    },
  });

  // 初始化角色选择
  // TODO(react19): 派生 state 反模式；建议重构为 useMemo 或条件渲染时直接计算
  useEffect(() => {
    if (showCharacterManager && project) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedCharacterIds(
        new Set(project.characters.map((c) => c.character.id))
      );
    }
  }, [showCharacterManager, project]);

  // 初始化项目数据
  // TODO(react19): 派生 state 反模式；建议把 title/inputText 改为非受控或由 project 派生
  useEffect(() => {
    if (project) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(project.title);
      if (project.inputText) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setInputText(project.inputText);
      }
      if (project.scenes.length > 0 && !selectedSceneId) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedSceneId(project.scenes[0].id);
      }
    }
  }, [project, selectedSceneId]);

  const parseMutation = useMutation({
    mutationFn: () => parseScript(inputText),
    onSuccess: async (result) => {
      await saveScenes(projectId, result.scenes);
      await apiUpdateProject(projectId, {
        inputText,
        title: result.title || title,
      });
      invalidateProject();
    },
  });

  const updateTitleMutation = useMutation({
    mutationFn: (newTitle: string) =>
      apiUpdateProject(projectId, { title: newTitle }),
    onSuccess: () => {
      invalidateProject();
      setEditingTitle(false);
    },
  });

  const updateSceneMutation = useMutation({
    mutationFn: ({
      sceneId,
      data,
    }: {
      sceneId: string;
      data: Partial<Scene>;
    }) => apiUpdateScene(projectId, sceneId, data),
    onSuccess: invalidateProject,
  });

  const handleSceneDurationChange = useCallback(
    (sceneId: string, duration: number) => {
      updateSceneMutation.mutate({ sceneId, data: { duration } });
    },
    [updateSceneMutation]
  );

  const updateProject = useCallback(
    (data: Partial<ProjectDetail>) => apiUpdateProject(projectId, data),
    [projectId]
  );

  const selectedScene = project?.scenes.find((s) => s.id === selectedSceneId);

  return {
    // 数据
    project,
    isLoading,
    error,
    allCharacters,
    selectedScene,

    // UI 状态
    inputText,
    setInputText,
    selectedSceneId,
    setSelectedSceneId,
    editingTitle,
    setEditingTitle,
    title,
    setTitle,
    showCharacterManager,
    setShowCharacterManager,
    selectedCharacterIds,
    setSelectedCharacterIds,

    // mutations
    parseMutation,
    updateTitleMutation,
    updateSceneMutation,
    updateCharactersMutation,

    // actions
    handleSceneDurationChange,
    updateProject,
    invalidateProject,
    projectId,
    queryClient,
  };
}
