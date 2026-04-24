"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Scene, ProjectDetail } from "@/types";
import { buildFinalPrompt } from "@/lib/prompt-builder";
import { apiUpdateScene } from "./use-editor-project";

export interface GenerateImageResult {
  imageUrl: string;
  strategy?: string;
  attemptCount?: number;
  cost?: number;
}

interface GenerateSceneImageOptions {
  style?: string;
  imageConfigId?: string;
  /** 角色参考图 URL（通常是 scene.selectedCharacter.referenceImages[0]） */
  referenceImage?: string;
  /** 追加的 negative prompt；服务端会与预设拼接 */
  negativePrompt?: string;
}

async function generateSceneImage(
  projectId: string,
  sceneId: string,
  prompt: string,
  options?: GenerateSceneImageOptions
): Promise<GenerateImageResult> {
  const res = await fetch("/api/generate/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      projectId,
      sceneId,
      style: options?.style,
      imageConfigId: options?.imageConfigId,
      referenceImage: options?.referenceImage,
      negativePrompt: options?.negativePrompt,
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(error?.error || "Failed to generate image");
  }
  const data = await res.json();
  await apiUpdateScene(projectId, sceneId, {
    imageUrl: data.imageUrl,
    imageStatus: "COMPLETED",
  });
  return data;
}

/**
 * 从场景 / 项目数据派生单张生成所需的 prompt 组件。
 *
 * 为什么集中在这里：原先编辑器直接拼接 `[stylePrefix, scene.description, shotType, mood]`
 * 绕过了 `buildFinalPrompt` 与服务端的增强管线，导致角色外貌描述丢失、无 negative prompt、
 * 无参考图。现在统一走 `buildFinalPrompt`，并把 `referenceImage` 传给服务端激活 orchestrator
 * 的 reference_edit 策略。
 */
function derivePromptInputs(scene: Scene, project: ProjectDetail | undefined) {
  const referenceImage = scene.selectedCharacter?.referenceImages?.[0];
  return buildFinalPrompt({
    style: project?.style,
    sceneDescription: scene.description,
    shotType: scene.shotType,
    emotion: scene.emotion,
    referenceImageUrl: referenceImage,
  });
}

export { generateSceneImage };

export function useGenerationActions(
  projectId: string,
  project: ProjectDetail | undefined
) {
  const queryClient = useQueryClient();
  const invalidateProject = () =>
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  const generateImageMutation = useMutation({
    mutationFn: async ({
      sceneId,
      scene,
      imageConfigId,
    }: {
      sceneId: string;
      scene: Scene;
      imageConfigId?: string;
    }) => {
      await apiUpdateScene(projectId, sceneId, { imageStatus: "PROCESSING" });
      invalidateProject();

      const { prompt, negativePrompt, referenceImage } = derivePromptInputs(
        scene,
        project
      );

      return generateSceneImage(projectId, sceneId, prompt, {
        style: project?.style,
        imageConfigId,
        negativePrompt,
        referenceImage,
      });
    },
    onSuccess: invalidateProject,
    onError: async (_error, { sceneId }) => {
      await apiUpdateScene(projectId, sceneId, { imageStatus: "FAILED" });
      invalidateProject();
    },
  });

  const generateVideoMutation = useMutation({
    mutationFn: async ({
      sceneId,
      scene,
    }: {
      sceneId: string;
      scene: Scene;
    }) => {
      if (!scene.imageUrl) throw new Error("请先生成图片");

      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: scene.imageUrl,
          prompt: scene.description,
          duration: scene.duration > 5 ? 10 : 5,
          projectId,
          sceneId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "视频生成失败");
      }
      return res.json();
    },
    onSuccess: invalidateProject,
    onError: async (_error, { sceneId }) => {
      await apiUpdateScene(projectId, sceneId, { videoStatus: "FAILED" });
      invalidateProject();
    },
  });

  const generateAudioMutation = useMutation({
    mutationFn: async ({
      sceneId,
      scene,
    }: {
      sceneId: string;
      scene: Scene;
    }) => {
      const text = scene.dialogue || scene.narration;
      if (!text) throw new Error("没有对话或旁白内容");

      const res = await fetch("/api/generate/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: "default",
          speed: 1.0,
          projectId,
          sceneId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "配音生成失败");
      }
      return res.json();
    },
    onSuccess: invalidateProject,
    onError: async (_error, { sceneId }) => {
      await apiUpdateScene(projectId, sceneId, { audioStatus: "FAILED" });
      invalidateProject();
    },
  });

  const batchGenerateImagesMutation = useMutation({
    mutationFn: async ({ scenes }: { scenes: Scene[] }) => {
      const results: Array<{
        sceneId: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const scene of scenes) {
        if (scene.imageStatus === "PROCESSING") continue;

        try {
          await apiUpdateScene(projectId, scene.id, {
            imageStatus: "PROCESSING",
          });
          invalidateProject();

          const { prompt, negativePrompt, referenceImage } = derivePromptInputs(
            scene,
            project
          );

          await generateSceneImage(projectId, scene.id, prompt, {
            style: project?.style,
            negativePrompt,
            referenceImage,
          });
          results.push({ sceneId: scene.id, success: true });
        } catch (err) {
          await apiUpdateScene(projectId, scene.id, { imageStatus: "FAILED" });
          results.push({
            sceneId: scene.id,
            success: false,
            error: err instanceof Error ? err.message : "Unknown",
          });
        }
        invalidateProject();
      }

      return results;
    },
    onSettled: invalidateProject,
  });

  return {
    generateImageMutation,
    generateVideoMutation,
    generateAudioMutation,
    batchGenerateImagesMutation,
    invalidateProject,
  };
}
