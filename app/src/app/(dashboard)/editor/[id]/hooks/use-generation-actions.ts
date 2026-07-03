"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Scene, ProjectDetail } from "@/types";
import { buildFinalPrompt } from "@/lib/prompt-builder";
import { getThreeViewUrls } from "@/lib/three-views";
import { apiUpdateScene } from "./use-editor-project";
import { useToast } from "@/components/ui/toast";
import { formatApiError, toFriendlyError } from "@/lib/error-copy";

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
  /** 多角色参考图列表（优先于 referenceImage） */
  referenceImages?: string[];
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
      referenceImages: options?.referenceImages,
      negativePrompt: options?.negativePrompt,
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "图片生成失败"));
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
/**
 * 收集单个角色的参考图：优先三视图（front/side/back 多角度锁形象），
 * 再追加定妆照兜底；去重。无三视图则回落到 referenceImages[0]。
 */
function collectCharacterRefs(character: {
  referenceImages?: string[];
  referenceAssets?: { url: string; pose?: string | null; createdAt?: string }[];
}): string[] {
  const urls: string[] = [];
  // 三视图（多角度参考，放前面优先喂给模型）
  for (const url of getThreeViewUrls(character.referenceAssets)) {
    if (!urls.includes(url)) urls.push(url);
  }
  // 定妆照兜底（referenceImages[0]）
  const canonical = character.referenceImages?.[0];
  if (canonical && !urls.includes(canonical)) urls.push(canonical);
  return urls;
}

function derivePromptInputs(scene: Scene, project: ProjectDetail | undefined) {
  // 多角色场景：优先 selectedCharacterIds[] -> 映射 project.characters
  // 单角色场景：fallback 到 scene.selectedCharacter
  const projectCharMap = new Map(
    (project?.characters ?? []).map(({ character }) => [
      character.id,
      character,
    ])
  );

  // 每个选中角色收集其三视图+定妆照（充分利用三视图锁形象）
  const multiRefs = (scene.selectedCharacterIds ?? [])
    .map((id) => projectCharMap.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .flatMap((c) => collectCharacterRefs(c));

  const singleChar = scene.selectedCharacter;
  const singleRefs = singleChar ? collectCharacterRefs(singleChar) : [];

  const collected = multiRefs.length > 0 ? multiRefs : singleRefs;
  const referenceImageUrls = collected.length > 0 ? collected : undefined;
  // 单图字段保持兼容（取首张，通常是三视图正面或定妆照）
  const singleRef = collected[0];

  return buildFinalPrompt({
    style: project?.style,
    sceneDescription: scene.description,
    shotType: scene.shotType,
    emotion: scene.emotion,
    referenceImageUrl: singleRef,
    referenceImageUrls,
  });
}

export { generateSceneImage, derivePromptInputs };

/**
 * 按场景时长就近映射到 provider 支持的 5/10/15 秒档。
 * 单张、多版本、workflow 三条路径统一走此函数，避免各自不同的时长逻辑
 * （此前多版本把 15s 档压成 10s）。
 */
export function nearestVideoDuration(duration: number): 5 | 10 | 15 {
  return duration > 10 ? 15 : duration > 5 ? 10 : 5;
}

export function useGenerationActions(
  projectId: string,
  project: ProjectDetail | undefined
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const invalidateProject = () =>
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  // 精确更新缓存中单个 scene 的字段，不触发整 project 重拉/全量重渲染。
  // 批量生成时用它替代逐张 invalidateProject()，避免 N 张 = ~2N 次全量刷新
  // 导致的卡顿（perf-frontend P0）。
  const patchSceneInCache = (sceneId: string, patch: Partial<Scene>) => {
    const current = queryClient.getQueryData<ProjectDetail>([
      "project",
      projectId,
    ]);
    if (!current) return;
    queryClient.setQueryData<ProjectDetail>(["project", projectId], {
      ...current,
      scenes: current.scenes.map((sc) =>
        sc.id === sceneId ? { ...sc, ...patch } : sc
      ),
    });
  };

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
      // 精确置「生成中」，不整 project 重拉（此前 invalidateProject 会重新 GET
      // 整个 project 大 payload 并全列表重渲，perf-frontend P0）
      patchSceneInCache(sceneId, { imageStatus: "PROCESSING" });

      const { prompt, negativePrompt, referenceImage, referenceImages } =
        derivePromptInputs(scene, project);

      return generateSceneImage(projectId, sceneId, prompt, {
        style: project?.style,
        imageConfigId,
        negativePrompt,
        referenceImage,
        referenceImages,
      });
    },
    // 权威数据（imageUrl + COMPLETED）已在手，精确写回缓存即可，无需整页重拉
    onSuccess: (result, { sceneId }) =>
      patchSceneInCache(sceneId, {
        imageStatus: "COMPLETED",
        ...(result?.imageUrl ? { imageUrl: result.imageUrl } : {}),
      }),
    onError: async (error, { sceneId }) => {
      await apiUpdateScene(projectId, sceneId, { imageStatus: "FAILED" });
      patchSceneInCache(sceneId, { imageStatus: "FAILED" });
      // 映射为可行动的中文文案；积分不足/未配模型附「去充值/去配置」出口，
      // 避免用户对着前置条件类失败反复重试（ux-editor P2-12）
      const fe = toFriendlyError(error, "图片生成失败");
      toast.error(fe.message, fe.cta);
    },
  });

  const generateVideoMutation = useMutation({
    mutationFn: async ({
      sceneId,
      scene,
      videoConfigId,
    }: {
      sceneId: string;
      scene: Scene;
      videoConfigId?: string;
    }) => {
      if (!scene.imageUrl) throw new Error("请先生成图片");

      // 先落库 + 写缓存 PROCESSING 再发起同步生成（对齐图像端写法）：
      // 此前 PROCESSING patch 写在 await fetch 之后，请求返回时立刻被
      // onSuccess 覆写成 COMPLETED，「视频中」角标与条件轮询从未生效
      // （ux-editor P0-1：用户在 30-120s 等待期看不到任何生成中迹象）
      await apiUpdateScene(projectId, sceneId, { videoStatus: "PROCESSING" });
      patchSceneInCache(sceneId, { videoStatus: "PROCESSING" });

      // 复用图像端的派生：拿到与图像生成相同的 referenceImages
      // 让 flow2api-video / Veo 能走 R2V / 首尾帧路由
      const { referenceImages } = derivePromptInputs(scene, project);
      const aspectRatio =
        project?.aspectRatio === "9:16" ||
        project?.aspectRatio === "16:9" ||
        project?.aspectRatio === "1:1"
          ? project.aspectRatio
          : undefined;

      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: scene.imageUrl,
          prompt: scene.description,
          // 按场景时长就近映射到 provider 支持的 5/10/15s（15s 适配 Seedance 2.0 直出）
          duration: nearestVideoDuration(scene.duration),
          aspectRatio,
          referenceImages,
          projectId,
          sceneId,
          videoConfigId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(formatApiError(data, "视频生成失败"));
      }
      // 同步路径：服务端已把 videoUrl 落库并返回，onSuccess 精确写回缓存
      return res.json() as Promise<{ videoUrl?: string }>;
    },
    onSuccess: (result, { sceneId }) =>
      patchSceneInCache(sceneId, {
        videoStatus: "COMPLETED",
        ...(result?.videoUrl ? { videoUrl: result.videoUrl } : {}),
      }),
    onError: async (error, { sceneId }) => {
      await apiUpdateScene(projectId, sceneId, { videoStatus: "FAILED" });
      patchSceneInCache(sceneId, { videoStatus: "FAILED" });
      const fe = toFriendlyError(error, "视频生成失败");
      toast.error(fe.message, fe.cta);
    },
  });

  const generateAudioMutation = useMutation({
    mutationFn: async ({
      sceneId,
      scene,
      ttsConfigId,
    }: {
      sceneId: string;
      scene: Scene;
      ttsConfigId?: string;
    }) => {
      const text = scene.dialogue || scene.narration;
      if (!text) throw new Error("没有对话或旁白内容");

      // 先落库 + 写缓存 PROCESSING 再发起同步生成（同视频端修复，
      // 让「配音中」角标与条件轮询在等待期间可见）
      await apiUpdateScene(projectId, sceneId, { audioStatus: "PROCESSING" });
      patchSceneInCache(sceneId, { audioStatus: "PROCESSING" });

      // 优先用场景所选角色的 characterId，由服务端查 Character.voiceId 解析音色；
      // 找不到再走默认音色（保持原有行为）
      const characterId =
        scene.selectedCharacter?.id ?? scene.selectedCharacterId ?? undefined;

      const res = await fetch("/api/generate/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          characterId,
          speed: 1.0,
          projectId,
          sceneId,
          ttsConfigId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(formatApiError(data, "配音生成失败"));
      }
      // 同步路径：服务端已把 audioUrl 落库并返回，onSuccess 精确写回缓存
      return res.json() as Promise<{ audioUrl?: string }>;
    },
    onSuccess: (result, { sceneId }) =>
      patchSceneInCache(sceneId, {
        audioStatus: "COMPLETED",
        ...(result?.audioUrl ? { audioUrl: result.audioUrl } : {}),
      }),
    onError: async (error, { sceneId }) => {
      await apiUpdateScene(projectId, sceneId, { audioStatus: "FAILED" });
      patchSceneInCache(sceneId, { audioStatus: "FAILED" });
      const fe = toFriendlyError(error, "配音生成失败");
      toast.error(fe.message, fe.cta);
    },
  });

  const batchGenerateImagesMutation = useMutation({
    mutationFn: async ({
      scenes,
      imageConfigId,
    }: {
      scenes: Scene[];
      imageConfigId?: string;
    }) => {
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
          // 精确更新该 scene 状态（实时显示"生成中"），不整 project 重拉
          patchSceneInCache(scene.id, { imageStatus: "PROCESSING" });

          const { prompt, negativePrompt, referenceImage, referenceImages } =
            derivePromptInputs(scene, project);

          const result = await generateSceneImage(projectId, scene.id, prompt, {
            style: project?.style,
            imageConfigId,
            negativePrompt,
            referenceImage,
            referenceImages,
          });
          // 精确写回生成结果（实时显示新图），不触发全量重渲染
          patchSceneInCache(scene.id, {
            imageStatus: "COMPLETED",
            ...(result?.imageUrl ? { imageUrl: result.imageUrl } : {}),
          });
          results.push({ sceneId: scene.id, success: true });
        } catch (err) {
          await apiUpdateScene(projectId, scene.id, { imageStatus: "FAILED" });
          patchSceneInCache(scene.id, { imageStatus: "FAILED" });
          results.push({
            sceneId: scene.id,
            success: false,
            error: err instanceof Error ? err.message : "Unknown",
          });
        }
      }

      return results;
    },
    // 批量结束给出成败汇总：此前 mutationFn 精心构造的 results 无人消费，
    // 部分失败被完全吞掉，用户导出时才发现缺图（ux-editor P1-4）
    onSuccess: (results) => {
      if (results.length === 0) return;
      const failed = results.filter((r) => !r.success);
      if (failed.length === 0) {
        toast.success(`批量生成完成：${results.length} 个分镜全部成功`);
        return;
      }
      const fe = toFriendlyError(failed[0].error, "");
      toast.error(
        `批量生成完成：成功 ${results.length - failed.length} 个，失败 ${failed.length} 个` +
          `${fe.message ? `（${fe.message}）` : ""}，失败分镜可在列表中单独重试`,
        fe.cta
      );
    },
    // 循环内已精确更新各 scene，结束时一次最终对账（拉权威数据）
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
