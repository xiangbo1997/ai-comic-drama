"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Scene, ProjectDetail } from "@/types";
import { buildFinalPrompt } from "@/lib/prompt-builder";
import { buildVideoScenePrompt } from "@/lib/prompts";
import { buildCanonicalCharacterEntry } from "@/lib/prompts/canonical-appearance";
import { getThreeViewUrls } from "@/lib/three-views";
// 配音文本字段单一真源（旁白+对白双段），与 workflow 侧两段合成对等
import { buildTtsTextPayload } from "@/lib/tts-request";
import { apiUpdateScene } from "./use-editor-project";
import { useToast } from "@/components/ui/toast";
import { toFriendlyError } from "@/lib/error-copy";
import {
  runGenerationTask,
  GENERATION_TIMEOUTS,
} from "@/lib/generation-task-client";
import { clampSceneDuration } from "@/services/generation/video-segmenter";

/** 单张候选（多候选抽卡回传，批次 2 · 1.4A） */
export interface ImageCandidate {
  attemptId: string;
  imageUrl: string;
  vlmScore?: number | null;
  recommended: boolean;
}

export interface GenerateImageResult {
  imageUrl: string;
  strategy?: string;
  attemptCount?: number;
  cost?: number;
  /** 多候选抽卡：本次生成的所有候选（含推荐张标记）；单张时长度为 1 */
  candidates?: ImageCandidate[];
  /**
   * 服务端能力告知（A1 防呆）：例如「当前图像模型不支持参考图」。
   *
   * 必须展示给用户——参考图被模型静默忽略时，出图会退化成纯文生图、
   * 人物必然不一致，而日志之外没有任何可见信号。链路：
   * strategy-resolver → orchestrator → image route → task output → 此处。
   */
  warnings?: string[];
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
  /** 项目画幅（9:16/16:9/1:1）；缺省时服务端 provider 会回落横屏 */
  aspectRatio?: string;
  /**
   * 迭代模式：把 baseImageUrl（上一版整图）当参考图 + note 提权重生成。
   * iterate=true 时 referenceImages 会被 [baseImageUrl] 覆盖，note 透传给服务端。
   */
  iterate?: boolean;
  /** 迭代追加指令（"改成夜晚"），服务端提权到 prompt 最前 */
  note?: string;
  /** 迭代基准图 URL（通常是 scene.imageUrl，即上一版结果） */
  baseImageUrl?: string;
  /** 迭代一致性锚图 URL（前镜当前图）；仅 iterate=true 时有意义 */
  iterationAnchorUrl?: string;
  /** 多候选抽卡档位（1 / 2 / 4，缺省 1）批次 2 · 1.4A */
  count?: 1 | 2 | 4;
}

async function generateSceneImage(
  projectId: string,
  sceneId: string,
  prompt: string,
  options?: GenerateSceneImageOptions
): Promise<GenerateImageResult> {
  // 异步化（2026-07-04）：POST 立即返回 taskId，此处轮询到终态后返回
  // 与原同步响应同形的结果——上层（单张/批量/多版本）调用方式零改动。
  // 迭代模式：参考图强制为上一版整图（覆盖角色参考），并透传 note/iterate
  const iterateRefs =
    options?.iterate && options?.baseImageUrl
      ? [options.baseImageUrl]
      : options?.referenceImages;

  const data = await runGenerationTask<GenerateImageResult>(
    "/api/generate/image",
    {
      prompt,
      projectId,
      sceneId,
      style: options?.style,
      imageConfigId: options?.imageConfigId,
      referenceImage: options?.referenceImage,
      referenceImages: iterateRefs,
      negativePrompt: options?.negativePrompt,
      aspectRatio: options?.aspectRatio,
      note: options?.note,
      iterate: options?.iterate,
      iterationAnchorUrl: options?.iterate
        ? options?.iterationAnchorUrl
        : undefined,
      // 多候选档位（缺省 1，零回归）；迭代模式强制单张
      count: options?.iterate ? 1 : options?.count,
    },
    { timeoutMs: GENERATION_TIMEOUTS.image, fallbackError: "图片生成失败" }
  );
  // 服务端已在任务事务里写库；此处幂等重写以兼容旧行为（多版本并行路径依赖）
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
 * 再追加定妆锚兜底；去重。
 *
 * 定妆锚必须取 `canonicalImageUrl`（见 lib/character-finalized.ts 的权威说明：
 * 出图编排器 / strategy-resolver / workflow-engine 实际消费的都是该字段）。
 * 此前这里硬编码 `referenceImages[0]`，且类型签名里根本没有 canonicalImageUrl
 * ——用户做完三视图定妆，编辑器手动路径却仍拿遗留数组首图当锚，定稿白做。
 * referenceImages[0] 仅作老数据兜底（canonicalImageUrl 为空时）。
 */
function collectCharacterRefs(character: {
  canonicalImageUrl?: string | null;
  referenceImages?: string[];
  referenceAssets?: { url: string; pose?: string | null; createdAt?: string }[];
}): string[] {
  const urls: string[] = [];
  // 三视图（多角度参考，放前面优先喂给模型）
  for (const url of getThreeViewUrls(character.referenceAssets)) {
    if (!urls.includes(url)) urls.push(url);
  }
  // 定妆锚兜底：权威字段优先，老数据回落遗留数组首图
  const canonical =
    character.canonicalImageUrl?.trim() || character.referenceImages?.[0];
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

/**
 * 读取项目画幅（仅放行三个合法值）。
 * 图片/视频生成必须显式携带：请求体缺省时服务端 provider 会回落横屏，
 * 9:16 项目就会生成横图（2026-07-08 修复的丢参 bug）。
 */
function projectAspectRatio(
  project: ProjectDetail | undefined
): string | undefined {
  return project?.aspectRatio === "9:16" ||
    project?.aspectRatio === "16:9" ||
    project?.aspectRatio === "1:1"
    ? project.aspectRatio
    : undefined;
}

/**
 * 主角色身份前缀（≤200 字）：视频人物一致性锚。
 * workflow 引擎用 CharacterBible.canonicalPrompt 做同样的事（workflow-engine.ts
 * buildSceneCharacterContext），编辑器手动路径此前完全没传——I2V 只靠首帧
 * 锚定，画面一动人物就漂。这里取主角色的外貌描述补齐，provider 会把它
 * 前置注入视频 prompt（见 flow2api-video.ts#buildVideoPrompt）。
 *
 * 外貌文本走 `buildCanonicalCharacterEntry`（冻结外貌单一真源）而非手拼
 * `${name}: ${description}`：一是与定妆照 / 分镜出图 / 场景增强三条路径逐字同源
 * （见 lib/prompts/canonical-appearance.ts 的根因说明），二是原写法在
 * `description` 为空时直接返回 undefined，视频端就彻底没有身份约束了——而
 * 名字本身就是可用的身份锚，结构化外貌字段也比自由文本精确。
 */
function deriveIdentityPrompt(
  scene: Scene,
  project: ProjectDetail | undefined
): string | undefined {
  const byId = new Map(
    (project?.characters ?? []).map(({ character }) => [
      character.id,
      character,
    ])
  );
  const primaryId =
    scene.selectedCharacterIds?.[0] ??
    scene.selectedCharacter?.id ??
    scene.selectedCharacterId ??
    undefined;
  // 回落 scene.selectedCharacter：角色未关联到项目（或 project 尚未加载）时，
  // 查表落空但分镜自己带着角色详情。与 derivePromptInputs 的双分支同构——
  // 两处只要有一处漏了回落，同一分镜就会出现「有参考图没身份前缀」的错配。
  const primary =
    (primaryId ? byId.get(primaryId) : undefined) ??
    scene.selectedCharacter ??
    undefined;
  if (!primary?.name) return undefined;
  // gender/age/appearance 由项目 GET 的窄 select 回传（见 api/projects/[id] 的
  // characters.character 与 selectedCharacter 两份对齐的 select）；任一字段缺失时
  // 函数自动跳过。全空时至少保留名字锚点（不再像原实现那样回落成 undefined）。
  const entry = buildCanonicalCharacterEntry(primary.name, {
    gender: primary.gender,
    age: primary.age,
    description: primary.description,
    appearance: primary.appearance,
  });
  return entry.slice(0, 200);
}

/**
 * 尾帧衔接：分镜开了 videoLinkNext 且下一镜已出图时，返回下一镜图片 URL
 * 作为尾帧（provider 命中 FL 首尾帧插值路由）；下一镜未出图或已是最后
 * 一镜时返回 undefined，静默回落普通 I2V（SceneEditor 开关旁有对应提示）。
 */
function deriveTailFrame(
  scene: Scene,
  project: ProjectDetail | undefined
): string | undefined {
  if (!scene.videoLinkNext || !project) return undefined;
  const ordered = [...project.scenes].sort((a, b) => a.order - b.order);
  const idx = ordered.findIndex((s) => s.id === scene.id);
  if (idx < 0) return undefined;
  return ordered[idx + 1]?.imageUrl ?? undefined;
}

export {
  generateSceneImage,
  derivePromptInputs,
  deriveIdentityPrompt,
  deriveTailFrame,
  projectAspectRatio,
};

/** 展示一条服务端能力告知的最小 toast 接口（避免把整个 ToastApi 拖进签名） */
type WarningToast = (message: string) => void;

/** 消费 GenerateImageResult.warnings 的展示函数 */
export type WarningSurfacer = (warnings?: string[]) => void;

/**
 * 构造一个「带去重账本」的能力告知展示函数。
 *
 * 为什么需要去重：模型能力是全局的（如「当前图像模型不支持参考图」），
 * 一次批量的 N 张分镜、一次多版本抽卡的 N 个模型，都会各自带回同一条文案。
 * 逐条弹会把屏幕刷满，用户反而看不见。账本记住已弹过的文案，同一条只弹一次。
 *
 * 为什么用 warning 级而非 error 级：出图本身是**成功**的，只是参考图被静默
 * 忽略、跨镜头一致性没有保证——用 error 会让用户以为图没生成出来。
 *
 * 做成模块级工厂（而非 hook 内闭包）是为了让不走 useGenerationActions 的路径
 * （多版本抽卡走 use-multi-generate 直接调 generateSceneImage）也能共用同一个
 * 账本实例——三条出图路径共享去重，才不会「批量弹过一次、多版本又弹一次」。
 */
export function createWarningSurfacer(toastWarning: WarningToast): {
  surface: WarningSurfacer;
} {
  const shown = new Set<string>();
  return {
    surface: (warnings?: string[]) => {
      for (const warning of warnings ?? []) {
        // 项目 toast 只吃单 string（不支持 { description } 对象形式），
        // 故逐条弹而非合并成一条——多条告知本就该分开读。
        const text = warning.trim();
        if (!text || shown.has(text)) continue;
        shown.add(text);
        toastWarning(text);
      }
    },
  };
}

/** 批量生成进度（驱动底部按钮的 X/Y 显示与「停止后续」入口） */
export interface BatchProgress {
  kind: "image" | "video" | "audio";
  done: number;
  total: number;
}

interface BatchOutcome {
  results: Array<{ sceneId: string; success: boolean; error?: string }>;
  cancelled: boolean;
}

export function useGenerationActions(
  projectId: string,
  project: ProjectDetail | undefined
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const invalidateProject = () =>
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  // 能力告知展示器：useMemo 持有，保证整个编辑器会话共享同一份去重账本
  // （若每次渲染重建，内部的 Set 随之重置，去重立刻失效、又变回逐张刷屏）。
  // 依赖 toast 而非 toast.warning：ToastApi 由 context 提供、引用稳定。
  const surfaceGenerationWarnings = useMemo(
    () => createWarningSurfacer(toast.warning).surface,
    [toast]
  );

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

  // ============ 批量生成基础设施 ============
  // 进度对外可见 + 可中途停止后续（当前已发出的同步请求无法中断，
  // 服务端会继续完成该张；停止只保证不再排队后续分镜）。
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(
    null
  );
  const batchCancelRef = useRef(false);
  const cancelBatch = () => {
    batchCancelRef.current = true;
  };

  // 批量运行期间拦截页面关闭/刷新：串行批量可能持续数分钟，
  // 误触离开会让用户丢失进度感知（ux-editor P0-3）
  const batchActive = batchProgress !== null;
  useEffect(() => {
    if (!batchActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Safari 不认单独的 preventDefault，必须设 returnValue 才弹确认框
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [batchActive]);

  /**
   * 串行批量执行器（图/视/音共用）：逐张置 PROCESSING → 生成 → 写回结果，
   * 收集成败列表供汇总 toast。底部按钮此前用并行 forEach 瞬间打出 N 个
   * 同步请求（易限流且无汇总），与顶部串行 batch 语义割裂（ux-editor P1-5）。
   */
  const runBatch = async (
    kind: BatchProgress["kind"],
    scenes: Scene[],
    opts: {
      statusField: "imageStatus" | "videoStatus" | "audioStatus";
      /** 执行单张生成，返回成功后要写回缓存的字段；失败抛错 */
      run: (scene: Scene) => Promise<Partial<Scene>>;
    }
  ): Promise<BatchOutcome> => {
    const results: BatchOutcome["results"] = [];
    batchCancelRef.current = false;
    setBatchProgress({ kind, done: 0, total: scenes.length });

    for (const scene of scenes) {
      if (batchCancelRef.current) break;
      if (scene[opts.statusField] === "PROCESSING") {
        setBatchProgress((prev) =>
          prev ? { ...prev, done: prev.done + 1 } : prev
        );
        continue;
      }
      try {
        await apiUpdateScene(projectId, scene.id, {
          [opts.statusField]: "PROCESSING",
        } as Partial<Scene>);
        patchSceneInCache(scene.id, {
          [opts.statusField]: "PROCESSING",
        } as Partial<Scene>);

        const patch = await opts.run(scene);
        patchSceneInCache(scene.id, {
          [opts.statusField]: "COMPLETED",
          ...patch,
        } as Partial<Scene>);
        results.push({ sceneId: scene.id, success: true });
      } catch (err) {
        await apiUpdateScene(projectId, scene.id, {
          [opts.statusField]: "FAILED",
        } as Partial<Scene>);
        patchSceneInCache(scene.id, {
          [opts.statusField]: "FAILED",
        } as Partial<Scene>);
        results.push({
          sceneId: scene.id,
          success: false,
          error: err instanceof Error ? err.message : "Unknown",
        });
      }
      setBatchProgress((prev) =>
        prev ? { ...prev, done: prev.done + 1 } : prev
      );
    }

    return { results, cancelled: batchCancelRef.current };
  };

  // 批量结束的成败汇总：此前 results 无人消费，部分失败被完全吞掉，
  // 用户导出时才发现缺图（ux-editor P1-4）
  const summarizeBatch = (label: string, outcome: BatchOutcome) => {
    const { results, cancelled } = outcome;
    const ok = results.filter((r) => r.success).length;
    const failed = results.length - ok;
    if (cancelled) {
      toast.info(`已停止批量${label}生成：完成 ${ok} 个，失败 ${failed} 个`);
      return;
    }
    if (results.length === 0) return;
    if (failed === 0) {
      toast.success(`批量${label}生成完成：${results.length} 个分镜全部成功`);
      return;
    }
    const fe = toFriendlyError(results.find((r) => !r.success)?.error, "");
    toast.error(
      `批量${label}生成完成：成功 ${ok} 个，失败 ${failed} 个` +
        `${fe.message ? `（${fe.message}）` : ""}，失败分镜可在列表中单独重试`,
      fe.cta
    );
  };

  // 单次视频/配音生成请求（单张与批量共用，保证参数派生完全一致）
  const requestVideo = async (scene: Scene, videoConfigId?: string) => {
    // 复用图像端的派生：拿到与图像生成相同的 referenceImages
    // 让 flow2api-video / Veo 能走 R2V 路由
    const { referenceImages } = derivePromptInputs(scene, project);
    const aspectRatio = projectAspectRatio(project);
    // 人物一致性：主角色身份前缀（此前编辑器路径缺失，视频人物漂移的根因）
    const identityPrompt = deriveIdentityPrompt(scene, project);
    // 尾帧衔接下一镜（videoLinkNext 开启且下一镜已出图时才有值）
    const lastFrameImage = deriveTailFrame(scene, project);

    // 异步化：发起任务并轮询到终态（等待期刷新页面不丢任务）
    return runGenerationTask<{ videoUrl?: string }>(
      "/api/generate/video",
      {
        imageUrl: scene.imageUrl,
        // 统一视频 prompt 构建器：镜头语言 + 运镜 + 氛围 + 连续性 + 负面词。
        // 身份前缀由 provider 单独 prepend（identityPrompt），此处不内联。
        prompt: buildVideoScenePrompt({
          description: scene.description,
          // 运动节拍：与 cameraMovement 同款透传。服务端有 LLM 导演时会重建覆盖，
          // 但用户无 LLM 配置 / 导演失败时回落此客户端 prompt，缺失 actionBeat
          // 会让「这一镜什么在动」的运动指令静默丢失（画面偏静止）。
          actionBeat: scene.actionBeat,
          style: project?.style,
          shotType: scene.shotType,
          cameraAngle: scene.cameraAngle,
          cameraMovement: scene.cameraMovement,
          lighting: scene.lighting,
          emotion: scene.emotion,
          duration: scene.duration,
          hasLastFrame: !!lastFrameImage,
          // 服务端仅在 LLM 导演成功时重建全字段 prompt；无 LLM 配置 / 导演失败
          // 时沿用本客户端 prompt，缺这两项会让口型指令与冲击高能指令静默丢失。
          hasDialogue: !!scene.dialogue?.trim(),
          beatType: scene.beatType,
        }),
        // 发送真实时长（1–60，客户端仅做安全钳制）：服务端按模型能力规划分段，
        // 超过单段时长自动拆成 N 段无缝拼接（不再在客户端预先压成 5/10/15 档）。
        duration: clampSceneDuration(scene.duration),
        aspectRatio,
        referenceImages,
        identityPrompt,
        lastFrameImage,
        projectId,
        sceneId: scene.id,
        videoConfigId,
      },
      { timeoutMs: GENERATION_TIMEOUTS.video, fallbackError: "视频生成失败" }
    );
  };

  const requestAudio = async (scene: Scene, ttsConfigId?: string) => {
    // 文本字段走 buildTtsTextPayload 单一真源：旁白 + 对白都在时双段合成
    // （旁白说书人声线在前、对白角色声线在后，服务端拼接），与一键 workflow
    // 的 synthesizeSceneAudio 对等，也与字幕侧 buildSubtitleSourceText 同取舍。
    const textPayload = buildTtsTextPayload(scene);
    if (!textPayload) throw new Error("没有对话或旁白内容");
    // 优先用场景所选角色的 characterId，由服务端查 Character.voiceId 解析音色；
    // 找不到再走默认音色（保持原有行为）
    const characterId =
      scene.selectedCharacter?.id ?? scene.selectedCharacterId ?? undefined;

    // 异步化：发起任务并轮询到终态（等待期刷新页面不丢任务）
    return runGenerationTask<{ audioUrl?: string }>(
      "/api/generate/tts",
      {
        ...textPayload,
        characterId,
        // 分镜级语速（SceneEditor 可调，0.5–2.0），未设置回落 1.0
        speed: scene.ttsSpeed ?? 1.0,
        projectId,
        sceneId: scene.id,
        ttsConfigId,
      },
      { timeoutMs: GENERATION_TIMEOUTS.tts, fallbackError: "配音生成失败" }
    );
  };

  const generateImageMutation = useMutation({
    mutationFn: async ({
      sceneId,
      scene,
      imageConfigId,
      iterate,
      note,
      iterationAnchorUrl,
      count,
    }: {
      sceneId: string;
      scene: Scene;
      imageConfigId?: string;
      /** 迭代模式：基于上一版整图 + note 重生成 */
      iterate?: boolean;
      /** 迭代追加指令 */
      note?: string;
      /** 迭代一致性锚图 URL（前镜当前图）；仅 iterate=true 时透传给服务端 */
      iterationAnchorUrl?: string;
      /** 多候选档位（1 / 2 / 4，缺省 1）批次 2 · 1.4A */
      count?: 1 | 2 | 4;
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
        aspectRatio: projectAspectRatio(project),
        // 迭代：把上一版整图作参考基准，note 提权重生成
        iterate,
        note,
        iterationAnchorUrl,
        baseImageUrl: iterate ? (scene.imageUrl ?? undefined) : undefined,
        // 多候选抽卡（迭代模式强制单张，在 generateSceneImage 内部再兜一次）
        count,
      });
    },
    // 权威数据（imageUrl + COMPLETED）已在手，精确写回缓存即可，无需整页重拉
    onSuccess: (result, { sceneId }) => {
      patchSceneInCache(sceneId, {
        imageStatus: "COMPLETED",
        ...(result?.imageUrl ? { imageUrl: result.imageUrl } : {}),
      });
      // 能力告知（包 A 的 warnings 链路终点）：如「当前图像模型不支持参考图」。
      // 这类情况生成是"成功"的，但参考图被静默忽略、人物必然不像——不弹出来
      // 用户只会以为是模型画得差，反复重试白花钱。
      surfaceGenerationWarnings(result?.warnings);
      // 刷新版本历史，让新版本缩略图立即出现在 SceneVersionStrip
      queryClient.invalidateQueries({ queryKey: ["scene-versions", sceneId] });
    },
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

      // 同步路径：服务端已把 videoUrl 落库并返回，onSuccess 精确写回缓存
      return requestVideo(scene, videoConfigId);
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
      // 预检：旁白与对白都空时不发请求（requestAudio 内部也会兜同一判据）
      if (!buildTtsTextPayload(scene)) {
        throw new Error("没有对话或旁白内容");
      }

      // 先落库 + 写缓存 PROCESSING 再发起同步生成（同视频端修复，
      // 让「配音中」角标与条件轮询在等待期间可见）
      await apiUpdateScene(projectId, sceneId, { audioStatus: "PROCESSING" });
      patchSceneInCache(sceneId, { audioStatus: "PROCESSING" });

      // 同步路径：服务端已把 audioUrl 落库并返回，onSuccess 精确写回缓存
      return requestAudio(scene, ttsConfigId);
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
    mutationFn: ({
      scenes,
      imageConfigId,
    }: {
      scenes: Scene[];
      imageConfigId?: string;
    }) =>
      runBatch("image", scenes, {
        statusField: "imageStatus",
        run: async (scene) => {
          const { prompt, negativePrompt, referenceImage, referenceImages } =
            derivePromptInputs(scene, project);
          const result = await generateSceneImage(projectId, scene.id, prompt, {
            style: project?.style,
            imageConfigId,
            negativePrompt,
            referenceImage,
            referenceImages,
            aspectRatio: projectAspectRatio(project),
          });
          // 能力告知同样要在批量路径可见（已去重，整批只弹一次）
          surfaceGenerationWarnings(result?.warnings);
          return (
            result?.imageUrl ? { imageUrl: result.imageUrl } : {}
          ) as Partial<Scene>;
        },
      }),
    onSuccess: (outcome) => summarizeBatch("图片", outcome),
    // 循环内已精确更新各 scene，结束时一次最终对账（拉权威数据）
    onSettled: () => {
      setBatchProgress(null);
      invalidateProject();
    },
  });

  const batchGenerateVideosMutation = useMutation({
    mutationFn: ({
      scenes,
      videoConfigId,
    }: {
      scenes: Scene[];
      videoConfigId?: string;
    }) => {
      // 视频批量按 order 串行（尾帧衔接依赖下一镜已出图，顺序稳定才可靠）
      const ordered = [...scenes].sort((a, b) => a.order - b.order);

      // 衔接保障（计划 §5 · 2.1 · 任务 B）：开了 videoLinkNext 但下一镜未出图的分镜，
      // 生成时会静默回落普通 I2V。批量前给一次汇总提示（不阻断、不自动出图——
      // 避免未经确认的积分消耗），让用户知道哪些衔接不会生效。
      if (project) {
        const byOrder = [...project.scenes].sort((a, b) => a.order - b.order);
        const fallbackCount = ordered.filter((scene) => {
          if (!scene.videoLinkNext) return false;
          const idx = byOrder.findIndex((s) => s.id === scene.id);
          const next = idx >= 0 ? byOrder[idx + 1] : undefined;
          return next ? !next.imageUrl : false;
        }).length;
        if (fallbackCount > 0) {
          toast.warning(
            `${fallbackCount} 个已衔接分镜的下一镜未出图，这些镜将回落普通生成`
          );
        }
      }

      return runBatch("video", ordered, {
        statusField: "videoStatus",
        run: async (scene) => {
          if (!scene.imageUrl) throw new Error("请先生成图片");
          const data = await requestVideo(scene, videoConfigId);
          return (
            data?.videoUrl ? { videoUrl: data.videoUrl } : {}
          ) as Partial<Scene>;
        },
      });
    },
    onSuccess: (outcome) => summarizeBatch("视频", outcome),
    onSettled: () => {
      setBatchProgress(null);
      invalidateProject();
    },
  });

  const batchGenerateAudiosMutation = useMutation({
    mutationFn: ({
      scenes,
      ttsConfigId,
    }: {
      scenes: Scene[];
      ttsConfigId?: string;
    }) =>
      runBatch("audio", scenes, {
        statusField: "audioStatus",
        run: async (scene) => {
          if (!scene.dialogue && !scene.narration)
            throw new Error("没有对话或旁白内容");
          const data = await requestAudio(scene, ttsConfigId);
          return (
            data?.audioUrl ? { audioUrl: data.audioUrl } : {}
          ) as Partial<Scene>;
        },
      }),
    onSuccess: (outcome) => summarizeBatch("配音", outcome),
    onSettled: () => {
      setBatchProgress(null);
      invalidateProject();
    },
  });

  return {
    generateImageMutation,
    generateVideoMutation,
    generateAudioMutation,
    batchGenerateImagesMutation,
    batchGenerateVideosMutation,
    batchGenerateAudiosMutation,
    batchProgress,
    cancelBatch,
    invalidateProject,
    /**
     * 能力告知展示器（共享去重账本）。多版本抽卡走 use-multi-generate 直接调
     * generateSceneImage、不经本 hook 的 mutation，需由页面把它接到那条路径上，
     * 三条出图路径才算全覆盖。
     */
    surfaceGenerationWarnings,
  };
}
