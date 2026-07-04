"use client";

import { useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import type { Scene } from "@/types";
import { TimelineDialogs } from "./components/TimelineDialogs";
import Link from "next/link";
import { X } from "lucide-react";
import { TimelineEditor } from "@/components/timeline-editor";
import { PreviewPlayer } from "@/components/preview-player";
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
import { useExport } from "./hooks/use-export";
import { useMultiGenerate } from "./hooks/use-multi-generate";
import { EditorSkeleton } from "@/components/ui/query-state";
import { useToast } from "@/components/ui/toast";

export default function EditorPage() {
  const params = useParams();
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

  // 重新解析剧本会 deleteMany + createMany 全量重建分镜，已生成的图/视/音
  // URL 随之丢失（feature P0：作品瞬间蒸发且无撤销）。已有任一媒体产物或
  // 分镜级配置（按旧 sceneId 索引，重建后全部悬垂失效）时二次确认。
  // 用 toast.confirm 替代原生 window.confirm，与删除项目等保持品牌一致。
  const handleParse = useCallback(async () => {
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
    if (hasMedia || hasSceneConfig) {
      const ok = await toast.confirm(
        `重新解析会清空当前所有分镜及已生成的图片 / 视频 / 配音${
          hasSceneConfig
            ? "，已配置的转场 / 贴图 / 字幕位置 / 滤镜也会随分镜重建而失效"
            : ""
        }，且无法撤销。确定继续？`
      );
      if (!ok) return;
    }
    editor.parseMutation.mutate();
  }, [editor.project, editor.parseMutation, toast]);

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

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <EditorHeader
        title={editor.editingTitle ? editor.title : project.title}
        editingTitle={editor.editingTitle}
        showTimeline={showTimeline}
        showSettings={showSettings}
        hasScenes={project.scenes.length > 0}
        canExport={project.scenes.some((s) => s.imageUrl)}
        onTitleChange={editor.setTitle}
        onTitleSave={(t) => editor.updateTitleMutation.mutate(t)}
        onEditTitle={() => editor.setEditingTitle(true)}
        onToggleTimeline={() => setShowTimeline(!showTimeline)}
        onToggleSettings={() => setShowSettings(!showSettings)}
        onMusic={() => setShowBgmDialog(true)}
        onPreview={() => setShowPreviewDialog(true)}
        onExport={() => setShowExportDialog(true)}
      />

      {/* 移动端明确提示：输入/编辑栏在 md 以下隐藏，此前是静默缺失——
          手机用户看得到分镜却找不到创作入口（ux-onboarding P2-9） */}
      <div className="border-border bg-primary/10 text-muted-foreground border-b px-4 py-2 text-center text-xs md:hidden">
        编辑功能需要更大屏幕，请在桌面端打开以获得完整创作体验
      </div>

      {/* 管线进度总览条 */}
      <PipelineProgress project={project} />

      {/* Settings Panel — Stage 3.8 抽出到独立组件 */}
      {showSettings && (
        <SettingsPanel
          style={project.style}
          aspectRatio={project.aspectRatio}
          onStyleChange={(style) => editor.updateProject({ style })}
          onAspectRatioChange={(aspectRatio) =>
            editor.updateProject({ aspectRatio })
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
          onStartWorkflow={() =>
            workflow.start(editor.inputText, { style: project.style })
          }
          isWorkflowRunning={workflow.isRunning}
          dramaScriptSlot={
            <DramaScriptPanel
              projectId={projectId}
              project={project}
              onApplyAsInput={editor.setInputText}
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
          updateScene={handleUpdateSceneFromList}
          mediaConfig={mediaConfig}
          queryClient={editor.queryClient}
          projectId={projectId}
        />

        <SceneEditor
          scene={editor.selectedScene}
          aspectRatio={project.aspectRatio}
          selectedImageConfig={selectedImageConfig}
          onImageConfigChange={setSelectedImageConfig}
          onOpenMultiImageDialog={() => setShowMultiImageDialog(true)}
          onUpdateScene={(sceneId, data) =>
            editor.updateSceneMutation.mutate({ sceneId, data })
          }
          onGenerateImage={(sceneId, scene) =>
            generation.generateImageMutation.mutate({
              sceneId,
              scene,
              imageConfigId: selectedImageConfig,
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
      {showPreviewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-background flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl">
            <div className="border-border flex shrink-0 items-center justify-between border-b px-6 py-4">
              <h2 className="text-xl font-semibold">预览播放</h2>
              <button
                onClick={() => setShowPreviewDialog(false)}
                className="hover:bg-card rounded-lg p-2 transition"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 p-4">
              <PreviewPlayer
                scenes={project.scenes}
                aspectRatio={project.aspectRatio}
                onSceneChange={editor.setSelectedSceneId}
                currentSceneId={editor.selectedSceneId ?? undefined}
                subtitleStyle={project.generationParams?.subtitleStyle}
                subtitlePositions={project.generationParams?.subtitlePositions}
                onSubtitlePositionChange={handleSubtitlePositionChange}
                watermark={project.generationParams?.watermark}
                stickers={project.generationParams?.stickers}
                transitions={project.generationParams?.transitions}
                sceneEffects={project.generationParams?.sceneEffects}
                backgroundMusic={project.generationParams?.backgroundMusic}
              />
            </div>
          </div>
        </div>
      )}

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        exportStatus={exportStatus}
        onExport={handleExport}
        // 时间轴入口已配置的字幕/水印作为导出表单初值，保证预览/时间轴/导出三处一致
        initialSubtitleStyle={project.generationParams?.subtitleStyle}
        initialWatermark={project.generationParams?.watermark}
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
    </div>
  );
}
