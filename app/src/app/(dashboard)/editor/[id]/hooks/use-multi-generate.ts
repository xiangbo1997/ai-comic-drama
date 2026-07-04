"use client";

import { useCallback } from "react";
import type { Scene, ProjectDetail } from "@/types";
import {
  generateSceneImage,
  derivePromptInputs,
  nearestVideoDuration,
} from "./use-generation-actions";
import {
  runGenerationTask,
  GENERATION_TIMEOUTS,
} from "@/lib/generation-task-client";

// MultiGenerateDialog.onGenerate 的入参形态（该组件未导出此类型，就近声明）
type MultiGenerateConfig = { configId: string; modelId: string };
type GenerateMode = "SERIAL" | "PARALLEL";

interface UseMultiGenerateArgs {
  projectId: string;
  // 页面 early-return 前调用本 hook，此时 project 可能尚未加载；各处理器仅在
  // 页面渲染完成（project 非空）后才可能被触发，故内部再做一次空值守卫。
  project: ProjectDetail | undefined;
  selectedScene: Scene | undefined;
  invalidateProject: () => void;
  onCloseImage: () => void;
  onCloseVideo: () => void;
  onCloseAudio: () => void;
}

/**
 * 三个 MultiGenerateDialog 的 onGenerate 处理器。行为与原页面完全一致：
 * 图/视/音三条链路都复用与单张生成同一的增强管线（derivePromptInputs +
 * runGenerationTask），PARALLEL 走 Promise.allSettled、SERIAL 走 for-await，
 * 完成后统一 invalidateProject。
 */
export function useMultiGenerate({
  projectId,
  project,
  selectedScene,
  invalidateProject,
  onCloseImage,
  onCloseVideo,
  onCloseAudio,
}: UseMultiGenerateArgs) {
  const handleGenerateImages = useCallback(
    async (configs: MultiGenerateConfig[], mode: GenerateMode) => {
      if (!selectedScene || !project) return;
      onCloseImage();

      // 走与单张生成完全一致的增强管线：拿到风格化 prompt + 负向词 +
      // 角色三视图/定妆参考图。此前多版本手拼 prompt 绕过管线，产出脸崩、
      // 与定妆不符的图（feature-consistency P0）。
      const { prompt, negativePrompt, referenceImage, referenceImages } =
        derivePromptInputs(selectedScene, project);

      const generateOne = (configId?: string) =>
        generateSceneImage(projectId, selectedScene!.id, prompt, {
          style: project.style,
          imageConfigId: configId,
          negativePrompt,
          referenceImage,
          referenceImages,
        });

      if (mode === "PARALLEL") {
        await Promise.allSettled(
          configs.map((config) => generateOne(config.configId))
        );
      } else {
        for (const config of configs) {
          await generateOne(config.configId).catch(() => {});
        }
      }
      invalidateProject();
    },
    [projectId, project, selectedScene, invalidateProject, onCloseImage]
  );

  const handleGenerateVideos = useCallback(
    async (configs: MultiGenerateConfig[], mode: GenerateMode) => {
      if (!selectedScene?.imageUrl || !project) return;
      onCloseVideo();

      // 与单张视频一致：就近映射 5/10/15s 三档（不再把 15s 压成 10s），
      // 并注入角色参考图让 provider 走 R2V / 首尾帧路由锁形象。
      const { referenceImages } = derivePromptInputs(selectedScene, project);
      const videoAspectRatio =
        project.aspectRatio === "9:16" ||
        project.aspectRatio === "16:9" ||
        project.aspectRatio === "1:1"
          ? project.aspectRatio
          : undefined;

      // 异步化：走共享 start+poll 助手（与单张视频同一链路）
      const generateOne = (configId?: string) =>
        runGenerationTask(
          "/api/generate/video",
          {
            imageUrl: selectedScene!.imageUrl,
            prompt: selectedScene!.description,
            duration: nearestVideoDuration(selectedScene!.duration),
            aspectRatio: videoAspectRatio,
            referenceImages,
            projectId,
            sceneId: selectedScene!.id,
            videoConfigId: configId,
          },
          {
            timeoutMs: GENERATION_TIMEOUTS.video,
            fallbackError: "视频生成失败",
          }
        );

      if (mode === "PARALLEL") {
        await Promise.allSettled(
          configs.map((config) => generateOne(config.configId))
        );
      } else {
        for (const config of configs) {
          await generateOne(config.configId).catch(() => {});
        }
      }
      invalidateProject();
    },
    [projectId, project, selectedScene, invalidateProject, onCloseVideo]
  );

  const handleGenerateAudios = useCallback(
    async (configs: MultiGenerateConfig[], mode: GenerateMode) => {
      const text = selectedScene?.dialogue || selectedScene?.narration;
      if (!text) return;
      onCloseAudio();

      // 通过 characterId 让服务端从 Character.voiceId 解析音色
      const characterId =
        selectedScene?.selectedCharacter?.id ??
        selectedScene?.selectedCharacterId ??
        undefined;

      // 异步化：走共享 start+poll 助手（与单张配音同一链路）
      const generateOne = (configId?: string) =>
        runGenerationTask(
          "/api/generate/tts",
          {
            text,
            characterId,
            speed: selectedScene?.ttsSpeed ?? 1.0,
            projectId,
            sceneId: selectedScene!.id,
            ttsConfigId: configId,
          },
          {
            timeoutMs: GENERATION_TIMEOUTS.tts,
            fallbackError: "配音生成失败",
          }
        );

      if (mode === "PARALLEL") {
        await Promise.allSettled(
          configs.map((config) => generateOne(config.configId))
        );
      } else {
        for (const config of configs) {
          await generateOne(config.configId).catch(() => {});
        }
      }
      invalidateProject();
    },
    [projectId, selectedScene, invalidateProject, onCloseAudio]
  );

  return { handleGenerateImages, handleGenerateVideos, handleGenerateAudios };
}
