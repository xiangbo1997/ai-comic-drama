"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Scene, ProjectDetail } from "@/types";
import {
  generateSceneImage,
  derivePromptInputs,
  deriveIdentityPrompt,
  deriveTailFrame,
  projectAspectRatio,
  type WarningSurfacer,
} from "./use-generation-actions";
import {
  runGenerationTask,
  GENERATION_TIMEOUTS,
} from "@/lib/generation-task-client";
import { buildVideoScenePrompt } from "@/lib/prompts";
// 配音文本字段单一真源（旁白+对白双段），与单张配音/workflow 对等
import { buildTtsTextPayload } from "@/lib/tts-request";
import { clampSceneDuration } from "@/services/generation/video-segmenter";
import { runWithConcurrency } from "./run-with-concurrency";

/** 偏好接口返回形状（仅取本 hook 需要的并发上限字段） */
interface PreferenceResponse {
  preference?: { maxConcurrent?: number };
}

/** 无偏好或加载失败时的并发上限兜底（与 schema/后端默认值一致） */
const DEFAULT_MAX_CONCURRENT = 3;

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
  /**
   * 展示服务端能力告知（GenerateImageResult.warnings）。
   * 由页面从 useGenerationActions 取，三条出图路径共享同一去重账本。
   */
  onWarnings?: WarningSurfacer;
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
  onWarnings,
}: UseMultiGenerateArgs) {
  // 读取用户偏好的并发上限：PARALLEL 分支据此做有界并发（而非无界 allSettled）。
  // MultiGenerateDialog 的 onGenerate 只透传 mode，不带 maxConcurrent，故在此
  // 复用同一 React Query key（"ai-preferences"，与弹窗共享缓存，零额外请求）。
  const { data: prefData } = useQuery<PreferenceResponse>({
    queryKey: ["ai-preferences"],
    queryFn: async () => {
      const res = await fetch("/api/ai-models/preferences");
      if (!res.ok) throw new Error("获取偏好失败");
      return res.json();
    },
    // 并发上限是用户设置项，同一会话内几乎不变；不设 staleTime 会让每次进入
    // 编辑器（乃至每次弹窗挂载）都打一发请求。设为 Infinity 后与弹窗真正共享
    // 同一份缓存，用户在设置页改动时那边 invalidate 仍会刷新这里。
    staleTime: Infinity,
  });
  const maxConcurrent =
    prefData?.preference?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;

  const handleGenerateImages = useCallback(
    async (configs: MultiGenerateConfig[], mode: GenerateMode) => {
      if (!selectedScene || !project) return;
      onCloseImage();

      // 走与单张生成完全一致的增强管线：拿到风格化 prompt + 负向词 +
      // 角色三视图/定妆参考图。此前多版本手拼 prompt 绕过管线，产出脸崩、
      // 与定妆不符的图（feature-consistency P0）。
      const { prompt, negativePrompt, referenceImage, referenceImages } =
        derivePromptInputs(selectedScene, project);

      // 能力告知（如「当前图像模型不支持参考图」）：多版本抽卡是第三条出图路径，
      // 此前直接丢弃 generateSceneImage 的返回值，warnings 到此断链。参考图被
      // 静默忽略时每个模型都会退化成纯文生图、人物必然不一致，而日志之外零信号。
      // 展示器由页面注入（与单张/批量共享同一去重账本，N 个模型同一条只弹一次）。
      const generateOne = async (configId?: string) => {
        const result = await generateSceneImage(
          projectId,
          selectedScene!.id,
          prompt,
          {
            style: project.style,
            imageConfigId: configId,
            negativePrompt,
            referenceImage,
            referenceImages,
            aspectRatio: projectAspectRatio(project),
          }
        );
        onWarnings?.(result?.warnings);
        return result;
      };

      if (mode === "PARALLEL") {
        // 有界并发：同时最多 maxConcurrent 个在飞（此前无界 allSettled 无视偏好）
        await runWithConcurrency(
          configs.map((config) => () => generateOne(config.configId)),
          maxConcurrent
        );
      } else {
        for (const config of configs) {
          await generateOne(config.configId).catch(() => {});
        }
      }
      invalidateProject();
    },
    [
      projectId,
      project,
      selectedScene,
      invalidateProject,
      onCloseImage,
      maxConcurrent,
      onWarnings,
    ]
  );

  const handleGenerateVideos = useCallback(
    async (configs: MultiGenerateConfig[], mode: GenerateMode) => {
      if (!selectedScene?.imageUrl || !project) return;
      onCloseVideo();

      // 与单张视频一致：发送真实时长（服务端按模型能力自动分段），
      // 注入角色参考图（R2V 路由）+ 身份前缀（人物一致性）+ 尾帧衔接。
      const { referenceImages } = derivePromptInputs(selectedScene, project);
      const videoAspectRatio = projectAspectRatio(project);
      const identityPrompt = deriveIdentityPrompt(selectedScene, project);
      const lastFrameImage = deriveTailFrame(selectedScene, project);

      // 异步化：走共享 start+poll 助手（与单张视频同一链路）
      const generateOne = (configId?: string) =>
        runGenerationTask(
          "/api/generate/video",
          {
            imageUrl: selectedScene!.imageUrl,
            // 统一视频 prompt 构建器（与单张视频同源）；身份前缀由 provider 单独 prepend
            prompt: buildVideoScenePrompt({
              description: selectedScene!.description,
              // 运动节拍：与单张视频同款透传（缺失会让「这一镜什么在动」丢失，画面偏静止）
              actionBeat: selectedScene!.actionBeat,
              style: project.style,
              shotType: selectedScene!.shotType,
              cameraAngle: selectedScene!.cameraAngle,
              cameraMovement: selectedScene!.cameraMovement,
              lighting: selectedScene!.lighting,
              emotion: selectedScene!.emotion,
              duration: selectedScene!.duration,
              hasLastFrame: !!lastFrameImage,
              // 服务端仅在 LLM 导演成功时重建全字段 prompt；无 LLM 配置 / 导演失败
              // 时沿用本客户端 prompt，缺这两项会让口型指令与冲击高能指令静默丢失。
              hasDialogue: !!selectedScene!.dialogue?.trim(),
              beatType: selectedScene!.beatType,
            }),
            duration: clampSceneDuration(selectedScene!.duration),
            aspectRatio: videoAspectRatio,
            referenceImages,
            identityPrompt,
            lastFrameImage,
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
        // 有界并发：同时最多 maxConcurrent 个在飞（此前无界 allSettled 无视偏好）
        await runWithConcurrency(
          configs.map((config) => () => generateOne(config.configId)),
          maxConcurrent
        );
      } else {
        for (const config of configs) {
          await generateOne(config.configId).catch(() => {});
        }
      }
      invalidateProject();
    },
    [
      projectId,
      project,
      selectedScene,
      invalidateProject,
      onCloseVideo,
      maxConcurrent,
    ]
  );

  const handleGenerateAudios = useCallback(
    async (configs: MultiGenerateConfig[], mode: GenerateMode) => {
      // 文本字段走 buildTtsTextPayload 单一真源（与单张配音同口径）：
      // 旁白 + 对白都在时双段合成，只有其一时走原单段路径。
      const textPayload = selectedScene
        ? buildTtsTextPayload(selectedScene)
        : null;
      if (!textPayload) return;
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
            ...textPayload,
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
        // 有界并发：同时最多 maxConcurrent 个在飞（此前无界 allSettled 无视偏好）
        await runWithConcurrency(
          configs.map((config) => () => generateOne(config.configId)),
          maxConcurrent
        );
      } else {
        for (const config of configs) {
          await generateOne(config.configId).catch(() => {});
        }
      }
      invalidateProject();
    },
    [projectId, selectedScene, invalidateProject, onCloseAudio, maxConcurrent]
  );

  return { handleGenerateImages, handleGenerateVideos, handleGenerateAudios };
}
