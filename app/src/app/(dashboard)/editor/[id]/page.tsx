"use client";

import { useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { Scene } from "@/types";
import type { SubtitleStyle } from "@/types/export-style";
import { buildTitleCards } from "@/lib/title-cards";
import { TimelineDialogs } from "./components/TimelineDialogs";
import Link from "next/link";
import { TimelineEditor } from "@/components/timeline-editor";
import { PreviewPlayer } from "@/components/preview-player";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MultiGenerateDialog } from "@/components/ai-models";
import { useEditorProject, apiUpdateScene } from "./hooks/use-editor-project";
import { useGenerationActions } from "./hooks/use-generation-actions";
import { EditorHeader } from "./components/EditorHeader";
import { PipelineProgress } from "./components/PipelineProgress";
import { ScriptPanel } from "./components/ScriptPanel";
import { DramaScriptPanel } from "./components/DramaScriptPanel";
import { SceneList } from "./components/SceneList";
import { SceneEditor } from "./components/SceneEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { ExportDialog } from "./components/ExportDialog";
import { CharacterManagerDialog } from "./components/CharacterManagerDialog";
import { WorkflowPanel } from "./components/WorkflowPanel";
import { useWorkflow } from "./hooks/use-workflow";
import { useSceneKeyboard } from "./hooks/use-scene-keyboard";
import { useExport } from "./hooks/use-export";
import { useMultiGenerate } from "./hooks/use-multi-generate";
import { EditorSkeleton } from "@/components/ui/query-state";
import { useToast } from "@/components/ui/toast";
import { collectUnfinalizedCharacterNames } from "@/lib/character-finalized";
import { ProducerReviewDialog } from "./components/ProducerReviewDialog";
import {
  isProducerReviewComplete,
  countProducerReviewProgress,
} from "@/lib/producer-review";

export default function EditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.id as string;
  const toast = useToast();

  // 项目数据 & 操作
  const editor = useEditorProject(projectId);
  const generation = useGenerationActions(projectId, editor.project);
  // Workflow 完成后刷新分镜数据 + toast 通知——面板默认折叠在页面底部，
  // 跑完若无提示用户可能一直干等（ux-editor P1-6）
  const workflow = useWorkflow(projectId, () => {
    editor.invalidateProject();
    toast.success("Agent 全自动生成完成，请在分镜列表查看结果");
  });

  // 键盘切换分镜（↑/↓ 或 J/K）；在早期 return 前调用以守 hooks 规则，
  // 空 scenes 时 hook 内部自身短路
  useSceneKeyboard(
    editor.project?.scenes ?? [],
    editor.selectedSceneId,
    editor.setSelectedSceneId
  );

  // UI 状态
  const [showSettings, setShowSettings] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [showSubtitleStyleDialog, setShowSubtitleStyleDialog] = useState(false);
  const [showWatermarkDialog, setShowWatermarkDialog] = useState(false);
  const [showBgmDialog, setShowBgmDialog] = useState(false);
  const [showStickerDialog, setShowStickerDialog] = useState(false);
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [showEffectDialog, setShowEffectDialog] = useState(false);
  const [showMultiImageDialog, setShowMultiImageDialog] = useState(false);
  const [showMultiVideoDialog, setShowMultiVideoDialog] = useState(false);
  const [showMultiAudioDialog, setShowMultiAudioDialog] = useState(false);
  const [selectedImageConfig, setSelectedImageConfig] = useState<
    string | undefined
  >();
  const [selectedVideoConfig, setSelectedVideoConfig] = useState<
    string | undefined
  >();
  const [selectedAudioConfig, setSelectedAudioConfig] = useState<
    string | undefined
  >();
  const [showCharacterPanel, setShowCharacterPanel] = useState(true);
  // 一键 AI 制片人审阅弹窗（3.1）：用「手动开」+「已关」两个显式意图组合出可见性，
  // 避免用 effect+setState 同步 URL（React 19 会告警 cascading renders）。
  const [reviewManuallyOpened, setReviewManuallyOpened] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);

  // 导出状态机 + 进度轮询（下沉到 use-export.ts）
  const { exportStatus, handleExport, resetExport, stopExportPoll } =
    useExport(projectId);

  // 智能字幕：从各分镜配音识别字幕，回填 dialogue（识别文本即字幕来源）
  const handleTranscribe = async (): Promise<string> => {
    const res = await fetch(`/api/projects/${projectId}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "语音识别失败");
    }
    const dialogues: Record<string, string> = data.dialogues ?? {};
    const entries = Object.entries(dialogues);
    if (entries.length === 0) {
      return data.message || "未识别到有效语音";
    }
    // 批量回填各分镜 dialogue
    await Promise.all(
      entries.map(([sceneId, text]) =>
        apiUpdateScene(projectId, sceneId, { dialogue: text })
      )
    );
    editor.invalidateProject();
    return `已识别并回填 ${entries.length} 个分镜的字幕`;
  };

  // 重建分镜（重新解析 / 脚本直转）都会 deleteMany + createMany 全量重建，
  // 已生成的图/视/音 URL 随之丢失（feature P0：作品瞬间蒸发且无撤销）。
  // 已有任一媒体产物或分镜级配置（按旧 sceneId 索引，重建后全部悬垂失效）时
  // 二次确认。用 toast.confirm 替代原生 window.confirm，与删除项目保持品牌一致。
  const confirmSceneRebuild = useCallback(
    async (action: string) => {
      const gp = editor.project?.generationParams;
      const hasMedia = editor.project?.scenes?.some(
        (s) => s.imageUrl || s.videoUrl || s.audioUrl
      );
      const hasSceneConfig = Boolean(
        gp?.transitions?.length ||
        gp?.stickers?.length ||
        gp?.subtitlePositions?.length ||
        gp?.sceneEffects?.length
      );
      if (!hasMedia && !hasSceneConfig) return true;
      return toast.confirm(
        `${action}会清空当前所有分镜及已生成的图片 / 视频 / 配音${
          hasSceneConfig
            ? "，已配置的转场 / 贴图 / 字幕位置 / 滤镜也会随分镜重建而失效"
            : ""
        }，且无法撤销。确定继续？`
      );
    },
    [editor.project, toast]
  );

  const handleParse = useCallback(async () => {
    if (!(await confirmSceneRebuild("重新解析"))) return;
    editor.parseMutation.mutate();
  }, [confirmSceneRebuild, editor.parseMutation]);

  // 角色定稿关口（批次 2 · 1.5）：批量出图 / 一键 workflow 前检查项目关联角色，
  // 存在未定稿（无 canonicalImageUrl）时提示，可跳过不硬阻断（toast.confirm）。
  // 返回 true 放行、false 取消。全部已定稿 / 无角色时直接放行不打扰。
  const editorProjectCharacters = editor.project?.characters;
  const confirmCharacterFinalization = useCallback(async () => {
    const names = collectUnfinalizedCharacterNames(editorProjectCharacters);
    if (names.length === 0) return true;
    return toast.confirm(
      `角色 ${names.join("、")} 尚未定稿定妆照，跨镜头一致性可能受影响，` +
        `建议先到角色页生成三视图。仍要继续吗？`
    );
  }, [editorProjectCharacters, toast]);

  // 短剧脚本「直接生成分镜列表」：结构化直转（含九宫格镜头语言），
  // 零 LLM 调用零积分；与重新解析共用防丢确认。
  // editor.X 先提为局部常量再入依赖数组（同 handleUpdateSceneFromList 的
  // React Compiler preserve-manual-memoization 约定）
  const editorSetInputText = editor.setInputText;
  const editorApplyScenesMutation = editor.applyScenesMutation;
  const handleApplyScriptToScenes = useCallback(
    async (scenes: Record<string, unknown>[], sourceText: string) => {
      if (!(await confirmSceneRebuild("直接生成分镜列表"))) return;
      editorSetInputText(sourceText);
      editorApplyScenesMutation.mutate({ scenes, sourceText });
    },
    [confirmSceneRebuild, editorSetInputText, editorApplyScenesMutation]
  );

  const handleToggleCharacter = (id: string) => {
    const newSet = new Set(editor.selectedCharacterIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    editor.setSelectedCharacterIds(newSet);
  };

  // 沿用下方 handleSubtitlePositionChange 的写法：把 editor.X 提为局部常量再入
  // 依赖数组，让 React Compiler 能保留手动 memo（成员表达式依赖会被推断成整个
  // editor 触发 preserve-manual-memoization 报错）。invalidateProject 本身是
  // 稳定 useCallback，回调引用稳定性不变 —— 这是 SceneList memo 的契约。
  const editorInvalidateProject = editor.invalidateProject;
  const handleUpdateSceneFromList = useCallback(
    (sceneId: string, data: Partial<Scene>) => {
      apiUpdateScene(projectId, sceneId, data).then(() =>
        editorInvalidateProject()
      );
    },
    [projectId, editorInvalidateProject]
  );

  // 字幕位置拖拽/快捷选择 → 按 sceneId upsert 到 generationParams.subtitlePositions。
  // 沿用项目「分镜级数组配置」的标准落库写法（同 stickers/sceneEffects）。
  const editorProject = editor.project;
  const editorUpdateProject = editor.updateProject;
  const handleSubtitlePositionChange = useCallback(
    (sceneId: string, x: number, y: number) => {
      if (!editorProject) return;
      const prev = editorProject.generationParams?.subtitlePositions ?? [];
      const next = [
        ...prev.filter((p) => p.sceneId !== sceneId),
        { sceneId, x, y },
      ];
      editorUpdateProject({
        generationParams: {
          ...editorProject.generationParams,
          subtitlePositions: next,
        },
      });
    },
    [editorProject, editorUpdateProject]
  );

  // 预览里直接拖拽贴图 → 按 stickerId 改写 generationParams.stickers 的 x/y。
  // 与 StickerDialog 九宫格/滑块同一数据源（都写 stickers.x/y），immutable map 写回。
  const handleStickerPositionChange = useCallback(
    (stickerId: string, x: number, y: number) => {
      if (!editorProject) return;
      const prev = editorProject.generationParams?.stickers ?? [];
      const next = prev.map((st) =>
        st.id === stickerId ? { ...st, x, y } : st
      );
      editorUpdateProject({
        generationParams: {
          ...editorProject.generationParams,
          stickers: next,
        },
      });
    },
    [editorProject, editorUpdateProject]
  );

  // 预览里拖字幕四角改字号 → 写回全片统一 subtitleStyle（与时间轴字幕样式弹窗
  // 同一数据源，两处一致）。落库写法同其他 generationParams 配置。
  const handleSubtitleStyleChange = useCallback(
    (style: SubtitleStyle) => {
      if (!editorProject) return;
      editorUpdateProject({
        generationParams: {
          ...editorProject.generationParams,
          subtitleStyle: style,
        },
      });
    },
    [editorProject, editorUpdateProject]
  );

  // 分镜播放速度变更 → 按 sceneId upsert 到 generationParams.sceneEffects.speed
  // （保留已有 effect 滤镜字段）。与滤镜/变速弹窗同一数据源，导出端 video-synthesis
  // 消费 speed 做 setpts/atempo 变速。speed=1 时移除该分镜的 speed 覆盖（回默认）。
  const handleSceneSpeedChange = useCallback(
    (sceneId: string, speed: number) => {
      if (!editorProject) return;
      const prev = editorProject.generationParams?.sceneEffects ?? [];
      const existing = prev.find((e) => e.sceneId === sceneId);
      const rest = prev.filter((e) => e.sceneId !== sceneId);
      // speed=1 且无滤镜 → 该分镜无需覆盖，整条移除保持配置干净
      const next =
        speed === 1 && !existing?.effect
          ? rest
          : [...rest, { sceneId, effect: existing?.effect ?? null, speed }];
      editorUpdateProject({
        generationParams: {
          ...editorProject.generationParams,
          sceneEffects: next,
        },
      });
    },
    [editorProject, editorUpdateProject]
  );

  // 将当前分镜速度一键应用到全部分镜 → 批量 upsert sceneEffects.speed。
  // 清理语义与单镜 handleSceneSpeedChange 完全同构（immutable）：保留悬垂条目，
  // 逐分镜按 speed=1&&无 effect 则不产条目（回默认保持配置干净），否则产 speed 覆盖。
  const handleApplySpeedToAllScenes = useCallback(
    async (speed: number) => {
      if (!editorProject) return;
      const scenes = editorProject.scenes;
      const ok = await toast.confirm(
        `将 ${speed}× 应用到全部 ${scenes.length} 个分镜？各分镜已单独设置的速度将被覆盖。`
      );
      if (!ok) return;
      const prev = editorProject.generationParams?.sceneEffects ?? [];
      const sceneIds = new Set(scenes.map((s) => s.id));
      // 保留 prev 中不属于当前分镜集合的悬垂条目（防御性，不动）
      const dangling = prev.filter((e) => !sceneIds.has(e.sceneId));
      const applied = scenes.flatMap((scene) => {
        const existing = prev.find((e) => e.sceneId === scene.id);
        // speed=1 且无滤镜 → 不产出该分镜条目（回默认）
        if (speed === 1 && !existing?.effect) return [];
        return [{ sceneId: scene.id, effect: existing?.effect ?? null, speed }];
      });
      editorUpdateProject({
        generationParams: {
          ...editorProject.generationParams,
          sceneEffects: [...dangling, ...applied],
        },
      });
      toast.success(`已将 ${speed}× 应用到全部分镜`);
    },
    [editorProject, editorUpdateProject, toast]
  );

  // 稳定化 mediaConfig 引用：原为内联对象字面量（含 6 个内联箭头），
  // 每次渲染都是新引用 → 击穿 SceneList 的 React.memo，任一弹窗 state
  // 变化都全量重渲染 20-40 张分镜卡片（perf-frontend P0）。useMemo +
  // useCallback 后，仅当 selected*Config 真正变化时才重建。
  const openMultiImage = useCallback(() => setShowMultiImageDialog(true), []);
  const openMultiVideo = useCallback(() => setShowMultiVideoDialog(true), []);
  const openMultiAudio = useCallback(() => setShowMultiAudioDialog(true), []);
  const mediaConfig = useMemo(
    () => ({
      image: {
        selected: selectedImageConfig,
        onChange: setSelectedImageConfig,
        onOpenMultiSelect: openMultiImage,
      },
      video: {
        selected: selectedVideoConfig,
        onChange: setSelectedVideoConfig,
        onOpenMultiSelect: openMultiVideo,
      },
      audio: {
        selected: selectedAudioConfig,
        onChange: setSelectedAudioConfig,
        onOpenMultiSelect: openMultiAudio,
      },
    }),
    [
      selectedImageConfig,
      selectedVideoConfig,
      selectedAudioConfig,
      openMultiImage,
      openMultiVideo,
      openMultiAudio,
    ]
  );

  // 三个多版本生成弹窗的 onGenerate 处理器（下沉到 use-multi-generate.ts）
  const closeMultiImage = useCallback(() => setShowMultiImageDialog(false), []);
  const closeMultiVideo = useCallback(() => setShowMultiVideoDialog(false), []);
  const closeMultiAudio = useCallback(() => setShowMultiAudioDialog(false), []);
  const multiGenerate = useMultiGenerate({
    projectId,
    project: editor.project,
    selectedScene: editor.selectedScene,
    invalidateProject: generation.invalidateProject,
    onCloseImage: closeMultiImage,
    onCloseVideo: closeMultiVideo,
    onCloseAudio: closeMultiAudio,
  });

  // 制片人审阅弹窗可见性（3.1，纯派生，无 effect）：
  // - 首进：URL 带 ?review=1 且项目由向导创建 → 自动打开（除非用户已手动关掉）；
  // - 之后：横幅「继续审阅」手动打开。
  const producerReview = editor.project?.generationParams?.producerReview;
  const isProducerProject = producerReview?.createdByProducer === true;
  const shouldAutoOpenReview =
    isProducerProject && searchParams.get("review") === "1" && !reviewDismissed;
  const showReviewDialog = reviewManuallyOpened || shouldAutoOpenReview;

  // Loading / Error states：三栏骨架替代整屏白转圈，
  // 新建项目跳转后的冷加载可感知布局（ux-onboarding P1-5）
  if (projectId === "new" || editor.isLoading) {
    return <EditorSkeleton />;
  }

  if (editor.error || !editor.project) {
    return (
      <div className="bg-background text-foreground flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-red-400">项目加载失败</p>
          <Link href="/projects" className="text-primary hover:underline">
            返回项目列表
          </Link>
        </div>
      </div>
    );
  }

  const { project } = editor;

  // 选中分镜的后继分镜（API 已按 order 升序返回）：SceneEditor 的
  // "尾帧衔接下一镜"开关据此判断是否为最后一镜/下一镜是否已出图
  const selectedSceneIndex = editor.selectedScene
    ? project.scenes.findIndex((s) => s.id === editor.selectedScene!.id)
    : -1;
  const nextScene =
    selectedSceneIndex >= 0
      ? (project.scenes[selectedSceneIndex + 1] ?? null)
      : null;

  // 成片包装（批6）：片头/片尾卡预览注入。
  // - isSeries：有 seriesId 即系列（决定卡片缺省开关，与导出端契约一致）；
  // - 底图：片头取首个有图分镜、片尾取末个有图分镜（无图则纯黑底）；
  // - hookText：客户端拿不到圣经，传 null → buildTitleCards 用通用追更文案兜底。
  const isSeries = !!project.seriesId;
  const scenesWithImage = project.scenes.filter((s) => s.imageUrl);
  const coverImageUrl = scenesWithImage[0]?.imageUrl ?? null;
  const endImageUrl =
    scenesWithImage[scenesWithImage.length - 1]?.imageUrl ?? null;
  const titleCards = buildTitleCards({
    projectTitle: project.title,
    episodeNumber: project.episodeNumber,
    hookText: null,
    coverImageUrl,
    endImageUrl,
    config: project.generationParams?.titleCards,
    isSeries,
  });

  return (
    // h-dvh 锁定视口高度（IDE 式布局）：三栏各自内部滚动（左栏根 / 中右栏
    // flex-1 区域均已带 overflow-y-auto）。此前 min-h-screen 让页面随内容撑高、
    // 整窗滚动，滚分镜列表会把左右栏信息一起滚走，内部滚动容器从未生效。
    <div className="bg-background text-foreground flex h-dvh flex-col">
      <EditorHeader
        title={editor.editingTitle ? editor.title : project.title}
        editingTitle={editor.editingTitle}
        showTimeline={showTimeline}
        showSettings={showSettings}
        hasScenes={project.scenes.length > 0}
        canExport={project.scenes.some((s) => s.imageUrl)}
        projectId={projectId}
        episodeNumber={project.episodeNumber}
        series={project.series}
        onTitleChange={editor.setTitle}
        onTitleSave={(t) => editor.updateTitleMutation.mutate(t)}
        onEditTitle={() => editor.setEditingTitle(true)}
        onToggleTimeline={() => setShowTimeline(!showTimeline)}
        onToggleSettings={() => setShowSettings(!showSettings)}
        onMusic={() => setShowBgmDialog(true)}
        onPreview={() => setShowPreviewDialog(true)}
        onExport={() => setShowExportDialog(true)}
        onSubtitle={() => setShowSubtitleStyleDialog(true)}
        onWatermark={() => setShowWatermarkDialog(true)}
        onSticker={() => setShowStickerDialog(true)}
        onTransition={() => setShowTransitionDialog(true)}
        onEffect={() => setShowEffectDialog(true)}
      />

      {/* 移动端明确提示：输入/编辑栏在 md 以下隐藏，此前是静默缺失——
          手机用户看得到分镜却找不到创作入口（ux-onboarding P2-9） */}
      <div className="border-border bg-primary/10 text-muted-foreground border-b px-4 py-2 text-center text-xs md:hidden">
        编辑功能需要更大屏幕，请在桌面端打开以获得完整创作体验
      </div>

      {/* 管线进度总览条 */}
      <PipelineProgress project={project} />

      {/* 制片人审阅横幅（3.1）：向导项目仍有未确认项时提示，点开审阅弹窗。
          常规项目（无 producerReview）此横幅完全不出现，零 UI 变化。 */}
      {isProducerProject &&
        (() => {
          const gate = countProducerReviewProgress(
            producerReview,
            project.characters.map((c) => c.character.id),
            project.scenes.map((s) => s.id)
          );
          const complete = isProducerReviewComplete(
            producerReview,
            project.characters.map((c) => c.character.id),
            project.scenes.map((s) => s.id)
          );
          if (complete) return null;
          return (
            <div className="border-agent/30 bg-agent/10 text-agent flex items-center justify-between gap-3 border-b px-4 py-2 text-sm">
              <span>
                AI 制片人草稿待审阅：已确认 {gate.confirmed}/{gate.total}
              </span>
              <button
                type="button"
                onClick={() => setReviewManuallyOpened(true)}
                className="border-agent/40 hover:bg-agent/20 shrink-0 rounded-md border px-3 py-1 text-xs font-medium transition"
              >
                继续审阅
              </button>
            </div>
          );
        })()}

      {/* Settings Panel — Stage 3.8 抽出到独立组件 */}
      {showSettings && (
        <SettingsPanel
          style={project.style}
          aspectRatio={project.aspectRatio}
          onStyleChange={(style) => editor.updateProject({ style })}
          onAspectRatioChange={(aspectRatio) =>
            editor.updateProject({ aspectRatio })
          }
          renderStrategy={project.generationParams?.renderStrategy}
          onRenderStrategyChange={(renderStrategy) =>
            editor.updateProject({
              generationParams: {
                ...project.generationParams,
                renderStrategy,
              },
            })
          }
        />
      )}

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <ScriptPanel
          inputText={editor.inputText}
          onInputChange={editor.setInputText}
          onParse={handleParse}
          isParsing={editor.parseMutation.isPending}
          parseError={editor.parseMutation.error}
          project={project}
          showCharacterPanel={showCharacterPanel}
          onToggleCharacterPanel={() =>
            setShowCharacterPanel(!showCharacterPanel)
          }
          onManageCharacters={() => editor.setShowCharacterManager(true)}
          onStartWorkflow={async () => {
            // 定稿关口（批次 2 · 1.5）：一键全自动前提示未定稿角色，可跳过
            if (!(await confirmCharacterFinalization())) return;
            workflow.start(editor.inputText, { style: project.style });
          }}
          isWorkflowRunning={workflow.isRunning}
          dramaScriptSlot={
            <DramaScriptPanel
              projectId={projectId}
              project={project}
              onApplyAsInput={editor.setInputText}
              onApplyToScenes={handleApplyScriptToScenes}
              isApplyingToScenes={editor.applyScenesMutation.isPending}
            />
          }
        />

        <SceneList
          project={project}
          selectedSceneId={editor.selectedSceneId}
          onSceneSelect={editor.setSelectedSceneId}
          onManageCharacters={() => editor.setShowCharacterManager(true)}
          generateImageMutation={generation.generateImageMutation}
          generateVideoMutation={generation.generateVideoMutation}
          generateAudioMutation={generation.generateAudioMutation}
          batchGenerateImagesMutation={generation.batchGenerateImagesMutation}
          batchGenerateVideosMutation={generation.batchGenerateVideosMutation}
          batchGenerateAudiosMutation={generation.batchGenerateAudiosMutation}
          batchProgress={generation.batchProgress}
          onCancelBatch={generation.cancelBatch}
          onBeforeBatchImages={confirmCharacterFinalization}
          updateScene={handleUpdateSceneFromList}
          mediaConfig={mediaConfig}
          queryClient={editor.queryClient}
          projectId={projectId}
          onIterateScene={(sceneId, scene, note, anchorImageUrl) =>
            // mutateAsync：体检弹窗要拿到本次提交的 Promise 展示成功/失败终态
            // （rejection 已在弹窗内 catch，全局 onError 照常弹错误 toast）
            generation.generateImageMutation.mutateAsync({
              sceneId,
              scene,
              imageConfigId: selectedImageConfig,
              iterate: true,
              note,
              iterationAnchorUrl: anchorImageUrl,
            })
          }
        />

        <SceneEditor
          scene={editor.selectedScene}
          projectId={project.id}
          nextScene={nextScene}
          aspectRatio={project.aspectRatio}
          sceneSpeed={
            project.generationParams?.sceneEffects?.find(
              (e) => e.sceneId === editor.selectedScene?.id
            )?.speed ?? 1
          }
          onSceneSpeedChange={handleSceneSpeedChange}
          onApplySpeedToAll={handleApplySpeedToAllScenes}
          selectedImageConfig={selectedImageConfig}
          onImageConfigChange={setSelectedImageConfig}
          onOpenMultiImageDialog={() => setShowMultiImageDialog(true)}
          onUpdateScene={(sceneId, data) =>
            editor.updateSceneMutation.mutate({ sceneId, data })
          }
          onGenerateImage={(sceneId, scene, count) =>
            generation.generateImageMutation.mutate({
              sceneId,
              scene,
              imageConfigId: selectedImageConfig,
              count,
            })
          }
          onIterateImage={(sceneId, scene, note) =>
            generation.generateImageMutation.mutate({
              sceneId,
              scene,
              imageConfigId: selectedImageConfig,
              iterate: true,
              note,
            })
          }
          isGeneratingImage={generation.generateImageMutation.isPending}
          projectCharacters={project.characters}
          lastGenerationInfo={
            generation.generateImageMutation.data as
              | { strategy?: string; attemptCount?: number }
              | undefined
          }
          onCharacterRoleChange={(sceneId, orderedIds) => {
            editor.updateSceneMutation.mutate({
              sceneId,
              data: { selectedCharacterIds: orderedIds },
            });
          }}
        />
      </div>

      {/* Workflow Panel */}
      <WorkflowPanel
        status={workflow.status}
        events={workflow.events}
        isRunning={workflow.isRunning}
        error={workflow.error}
        onCancel={workflow.cancel}
      />

      {/* Timeline */}
      {showTimeline && project.scenes.length > 0 && (
        <TimelineEditor
          scenes={project.scenes}
          onSceneSelect={editor.setSelectedSceneId}
          onSceneDurationChange={editor.handleSceneDurationChange}
          selectedSceneId={editor.selectedSceneId}
          onSubtitleClick={() => setShowSubtitleStyleDialog(true)}
          onWatermarkClick={() => setShowWatermarkDialog(true)}
          onStickerClick={() => setShowStickerDialog(true)}
          onTransitionClick={() => setShowTransitionDialog(true)}
          onEffectClick={() => setShowEffectDialog(true)}
        />
      )}

      {/* 时间轴触发的六个配置弹窗（字幕/水印/配乐/贴图/转场/滤镜） */}
      <TimelineDialogs
        project={project}
        projectId={projectId}
        updateProject={editor.updateProject}
        onTranscribe={handleTranscribe}
        showSubtitleStyleDialog={showSubtitleStyleDialog}
        showWatermarkDialog={showWatermarkDialog}
        showBgmDialog={showBgmDialog}
        showStickerDialog={showStickerDialog}
        showTransitionDialog={showTransitionDialog}
        showEffectDialog={showEffectDialog}
        onCloseSubtitleStyle={() => setShowSubtitleStyleDialog(false)}
        onCloseWatermark={() => setShowWatermarkDialog(false)}
        onCloseBgm={() => setShowBgmDialog(false)}
        onCloseSticker={() => setShowStickerDialog(false)}
        onCloseTransition={() => setShowTransitionDialog(false)}
        onCloseEffect={() => setShowEffectDialog(false)}
      />

      {/* Preview Dialog */}
      <Dialog
        open={showPreviewDialog}
        onOpenChange={(open) => {
          if (!open) setShowPreviewDialog(false);
        }}
      >
        <DialogContent className="bg-background flex h-[88vh] max-w-4xl flex-col p-0 sm:max-w-4xl">
          <DialogHeader className="border-border shrink-0 border-b px-6 py-4 text-left">
            <DialogTitle className="text-xl">预览播放</DialogTitle>
            <DialogDescription className="sr-only">
              按分镜顺序播放已生成的图像、视频与配音
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 p-4">
            <PreviewPlayer
              scenes={project.scenes}
              aspectRatio={project.aspectRatio}
              onSceneChange={editor.setSelectedSceneId}
              currentSceneId={editor.selectedSceneId ?? undefined}
              subtitleStyle={project.generationParams?.subtitleStyle}
              subtitlePositions={project.generationParams?.subtitlePositions}
              onSubtitlePositionChange={handleSubtitlePositionChange}
              onSubtitleStyleChange={handleSubtitleStyleChange}
              watermark={project.generationParams?.watermark}
              stickers={project.generationParams?.stickers}
              onStickerPositionChange={handleStickerPositionChange}
              transitions={project.generationParams?.transitions}
              sceneEffects={project.generationParams?.sceneEffects}
              backgroundMusic={project.generationParams?.backgroundMusic}
              sfx={project.generationParams?.sfx}
              emphasisSceneIds={project.generationParams?.emphasis}
              colorGrade={project.generationParams?.colorGrade}
              titleCards={titleCards}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        exportStatus={exportStatus}
        projectId={projectId}
        onExport={handleExport}
        // 审片报告建议「定位」→ 选中该分镜并关闭导出弹窗（复用 3.1 跳转写法）
        onJumpToScene={(sceneId) => {
          editor.setSelectedSceneId(sceneId);
          setShowExportDialog(false);
        }}
        // 时间轴入口已配置的字幕/水印作为导出表单初值，保证预览/时间轴/导出三处一致
        initialSubtitleStyle={project.generationParams?.subtitleStyle}
        initialWatermark={project.generationParams?.watermark}
        // 成片包装（批6）初值 + 系列判定 + 持久化回调（写回 generationParams 让主预览同步）
        initialColorGrade={project.generationParams?.colorGrade}
        initialTitleCards={project.generationParams?.titleCards}
        isSeries={isSeries}
        onPersist={(patch) =>
          editor.updateProject({
            generationParams: {
              ...project.generationParams,
              ...patch,
            },
          })
        }
        onClose={() => {
          stopExportPoll();
          setShowExportDialog(false);
        }}
        onRetry={resetExport}
      />

      {/* Multi-Generate Dialogs */}
      <MultiGenerateDialog
        category="IMAGE"
        isOpen={showMultiImageDialog}
        onClose={() => setShowMultiImageDialog(false)}
        onGenerate={multiGenerate.handleGenerateImages}
      />
      <MultiGenerateDialog
        category="VIDEO"
        isOpen={showMultiVideoDialog}
        onClose={() => setShowMultiVideoDialog(false)}
        onGenerate={multiGenerate.handleGenerateVideos}
      />
      <MultiGenerateDialog
        category="TTS"
        isOpen={showMultiAudioDialog}
        onClose={() => setShowMultiAudioDialog(false)}
        onGenerate={multiGenerate.handleGenerateAudios}
      />

      {/* Character Manager Dialog */}
      <CharacterManagerDialog
        isOpen={editor.showCharacterManager}
        allCharacters={editor.allCharacters}
        selectedCharacterIds={editor.selectedCharacterIds}
        isSaving={editor.updateCharactersMutation.isPending}
        onToggleCharacter={handleToggleCharacter}
        onSave={() =>
          editor.updateCharactersMutation.mutate(
            Array.from(editor.selectedCharacterIds)
          )
        }
        onClose={() => editor.setShowCharacterManager(false)}
      />

      {/* 一键 AI 制片人审阅弹窗（3.1）：仅向导项目会打开 */}
      {isProducerProject && (
        <ProducerReviewDialog
          isOpen={showReviewDialog}
          project={project}
          updateProject={editor.updateProject}
          invalidateProject={editor.invalidateProject}
          onJumpToScene={(sceneId) => {
            editor.setSelectedSceneId(sceneId);
            setReviewManuallyOpened(false);
            setReviewDismissed(true);
          }}
          onClose={() => {
            // 关闭即记为「已处理」：手动开的关掉、自动开的也不再自动重开
            setReviewManuallyOpened(false);
            setReviewDismissed(true);
          }}
        />
      )}
    </div>
  );
}
