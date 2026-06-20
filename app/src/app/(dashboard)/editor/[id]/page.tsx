"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import type { Scene } from "@/types";
import type { SubtitleStyle, Watermark } from "@/types/export-style";
import { SubtitleStyleDialog } from "./components/SubtitleStyleDialog";
import { WatermarkDialog } from "./components/WatermarkDialog";
import { StickerDialog } from "./components/StickerDialog";
import { TransitionDialog } from "./components/TransitionDialog";
import { SceneEffectDialog } from "./components/SceneEffectDialog";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import { TimelineEditor } from "@/components/timeline-editor";
import { PreviewPlayer } from "@/components/preview-player";
import { MultiGenerateDialog } from "@/components/ai-models";
import { useEditorProject, apiUpdateScene } from "./hooks/use-editor-project";
import {
  useGenerationActions,
  generateSceneImage,
} from "./hooks/use-generation-actions";
import { EditorHeader } from "./components/EditorHeader";
import { ScriptPanel } from "./components/ScriptPanel";
import { DramaScriptPanel } from "./components/DramaScriptPanel";
import { SceneList } from "./components/SceneList";
import { SceneEditor } from "./components/SceneEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { ExportDialog } from "./components/ExportDialog";
import { CharacterManagerDialog } from "./components/CharacterManagerDialog";
import { WorkflowPanel } from "./components/WorkflowPanel";
import { BgmDialog } from "./components/BgmDialog";
import { useWorkflow } from "./hooks/use-workflow";

export default function EditorPage() {
  const params = useParams();
  const projectId = params.id as string;

  // 项目数据 & 操作
  const editor = useEditorProject(projectId);
  const generation = useGenerationActions(projectId, editor.project);
  // Workflow 完成后刷新分镜数据（修复 Agent 全自动跑完列表不更新）
  const workflow = useWorkflow(projectId, () => editor.invalidateProject());

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
  const [exportStatus, setExportStatus] = useState<{
    isExporting: boolean;
    taskId: string | null;
    progress: number;
    error: string | null;
    videoUrl: string | null;
  }>({
    isExporting: false,
    taskId: null,
    progress: 0,
    error: null,
    videoUrl: null,
  });
  // 导出进度轮询定时器引用——用于卸载/关闭时清理，避免僵尸轮询
  const exportPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopExportPoll = () => {
    if (exportPollRef.current) {
      clearTimeout(exportPollRef.current);
      exportPollRef.current = null;
    }
  };
  // 组件卸载时停止轮询
  useEffect(() => stopExportPoll, []);

  // 导出视频
  const handleExport = async (options: {
    format: string;
    quality: string;
    includeSubtitles: boolean;
    includeAudio: boolean;
    subtitleStyle?: SubtitleStyle;
    watermark?: Watermark;
  }) => {
    stopExportPoll();
    setExportStatus({
      isExporting: true,
      taskId: null,
      progress: 0,
      error: null,
      videoUrl: null,
    });

    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导出失败");
      }

      const { taskId, status, videoUrl } = await res.json();

      if (status === "completed" && videoUrl) {
        setExportStatus({
          isExporting: false,
          taskId: null,
          progress: 100,
          error: null,
          videoUrl,
        });
        // 尝试自动打开；若被浏览器拦截，弹窗内仍有下载链接兜底
        window.open(videoUrl, "_blank");
      } else {
        setExportStatus((prev) => ({ ...prev, taskId }));
        pollExportProgress(taskId);
      }
    } catch (err) {
      setExportStatus({
        isExporting: false,
        taskId: null,
        progress: 0,
        error: err instanceof Error ? err.message : "导出失败",
        videoUrl: null,
      });
    }
  };

  const pollExportProgress = async (taskId: string) => {
    // 轮询上限：2s/次 × 150 = 5 分钟。超时则停轮并提示，
    // 避免后端任务卡死（如进程重启丢任务）导致前端无限转圈。
    const MAX_POLL_ATTEMPTS = 150;
    let attempts = 0;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/export?taskId=${taskId}`
        );
        const data = await res.json();

        if (data.status === "completed") {
          stopExportPoll();
          setExportStatus({
            isExporting: false,
            taskId: null,
            progress: 100,
            error: null,
            videoUrl: data.videoUrl || null,
          });
          // 尝试自动打开；被拦截时弹窗内有下载链接兜底，不再静默关闭
          if (data.videoUrl) window.open(data.videoUrl, "_blank");
        } else if (data.status === "failed") {
          stopExportPoll();
          setExportStatus({
            isExporting: false,
            taskId: null,
            progress: 0,
            error: data.error || "导出失败",
            videoUrl: null,
          });
        } else if (attempts >= MAX_POLL_ATTEMPTS) {
          // 超时：停止轮询并提示，避免无限转圈
          stopExportPoll();
          setExportStatus({
            isExporting: false,
            taskId: null,
            progress: 0,
            error: "导出超时，请重试（任务可能已中断）",
            videoUrl: null,
          });
        } else {
          attempts++;
          setExportStatus((prev) => ({
            ...prev,
            progress: data.progress || 0,
          }));
          exportPollRef.current = setTimeout(poll, 2000);
        }
      } catch {
        stopExportPoll();
        setExportStatus({
          isExporting: false,
          taskId: null,
          progress: 0,
          error: "获取进度失败",
          videoUrl: null,
        });
      }
    };
    poll();
  };

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

  const handleToggleCharacter = (id: string) => {
    const newSet = new Set(editor.selectedCharacterIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    editor.setSelectedCharacterIds(newSet);
  };

  const handleUpdateSceneFromList = useCallback(
    (sceneId: string, data: Partial<Scene>) => {
      apiUpdateScene(projectId, sceneId, data).then(() =>
        editor.invalidateProject()
      );
    },
    [projectId, editor.invalidateProject]
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

  // Loading / Error states
  if (projectId === "new" || editor.isLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <Loader2 size={32} className="text-muted-foreground animate-spin" />
      </div>
    );
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
        onTitleChange={editor.setTitle}
        onTitleSave={(t) => editor.updateTitleMutation.mutate(t)}
        onEditTitle={() => editor.setEditingTitle(true)}
        onToggleTimeline={() => setShowTimeline(!showTimeline)}
        onToggleSettings={() => setShowSettings(!showSettings)}
        onMusic={() => setShowBgmDialog(true)}
        onPreview={() => setShowPreviewDialog(true)}
        onExport={() => setShowExportDialog(true)}
      />

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
          onParse={() => editor.parseMutation.mutate()}
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

      {/* 字幕样式弹窗（点击时间轴字幕轨触发，全片统一样式） */}
      {showSubtitleStyleDialog && (
        <SubtitleStyleDialog
          initialValue={project.generationParams?.subtitleStyle}
          onSave={(style) =>
            editor.updateProject({
              generationParams: {
                ...project.generationParams,
                subtitleStyle: style,
              },
            })
          }
          onTranscribe={handleTranscribe}
          onClose={() => setShowSubtitleStyleDialog(false)}
        />
      )}

      {/* 品牌水印弹窗（点击时间轴品牌水印入口触发，全片统一） */}
      {showWatermarkDialog && (
        <WatermarkDialog
          initialValue={project.generationParams?.watermark}
          onSave={(watermark) =>
            editor.updateProject({
              generationParams: {
                ...project.generationParams,
                watermark,
              },
            })
          }
          onClose={() => setShowWatermarkDialog(false)}
        />
      )}

      {showBgmDialog && (
        <BgmDialog
          projectId={projectId}
          initialValue={project.generationParams?.backgroundMusic}
          onSave={(backgroundMusic) =>
            editor.updateProject({
              generationParams: {
                ...project.generationParams,
                backgroundMusic,
              },
            })
          }
          onClose={() => setShowBgmDialog(false)}
        />
      )}

      {/* 贴图管理弹窗（点击时间轴 + 贴图 入口触发） */}
      {showStickerDialog && (
        <StickerDialog
          initialStickers={project.generationParams?.stickers}
          scenes={project.scenes.map((s) => ({
            id: s.id,
            order: s.order,
            description: s.description,
          }))}
          onSave={(stickers) =>
            editor.updateProject({
              generationParams: {
                ...project.generationParams,
                stickers,
              },
            })
          }
          onClose={() => setShowStickerDialog(false)}
        />
      )}

      {/* 转场设置弹窗（点击时间轴转场入口触发，分镜之间逐个配置） */}
      {showTransitionDialog && (
        <TransitionDialog
          initialTransitions={project.generationParams?.transitions}
          scenes={project.scenes.map((s) => ({
            id: s.id,
            order: s.order,
            description: s.description,
          }))}
          onSave={(transitions) =>
            editor.updateProject({
              generationParams: {
                ...project.generationParams,
                transitions,
              },
            })
          }
          onClose={() => setShowTransitionDialog(false)}
        />
      )}

      {/* 滤镜 / 变速弹窗（点击时间轴滤镜入口触发，按分镜配置） */}
      {showEffectDialog && (
        <SceneEffectDialog
          initialEffects={project.generationParams?.sceneEffects}
          scenes={project.scenes.map((s) => ({
            id: s.id,
            order: s.order,
            description: s.description,
          }))}
          onSave={(sceneEffects) =>
            editor.updateProject({
              generationParams: {
                ...project.generationParams,
                sceneEffects,
              },
            })
          }
          onClose={() => setShowEffectDialog(false)}
        />
      )}

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
        onRetry={() => {
          stopExportPoll();
          setExportStatus({
            isExporting: false,
            taskId: null,
            progress: 0,
            error: null,
            videoUrl: null,
          });
        }}
      />

      {/* Multi-Generate Dialogs */}
      <MultiGenerateDialog
        category="IMAGE"
        isOpen={showMultiImageDialog}
        onClose={() => setShowMultiImageDialog(false)}
        onGenerate={async (configs, mode) => {
          if (!editor.selectedScene) return;
          setShowMultiImageDialog(false);

          const stylePrefix =
            project.style === "anime"
              ? "anime style, high quality anime illustration,"
              : project.style === "realistic"
                ? "photorealistic, cinematic lighting,"
                : project.style === "comic"
                  ? "comic book style, bold lines,"
                  : "anime style,";
          const prompt = [
            stylePrefix,
            editor.selectedScene.description,
            `shot type: ${editor.selectedScene.shotType || "中景"}`,
            `mood: ${editor.selectedScene.emotion || "neutral"}`,
            "masterpiece, best quality",
          ].join(", ");

          const generateOne = (configId?: string) =>
            generateSceneImage(projectId, editor.selectedScene!.id, prompt, {
              imageConfigId: configId,
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
          generation.invalidateProject();
        }}
      />
      <MultiGenerateDialog
        category="VIDEO"
        isOpen={showMultiVideoDialog}
        onClose={() => setShowMultiVideoDialog(false)}
        onGenerate={async (configs, mode) => {
          if (!editor.selectedScene?.imageUrl) return;
          setShowMultiVideoDialog(false);

          const generateOne = async (configId?: string) => {
            const res = await fetch("/api/generate/video", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageUrl: editor.selectedScene!.imageUrl,
                prompt: editor.selectedScene!.description,
                duration: editor.selectedScene!.duration > 5 ? 10 : 5,
                projectId,
                sceneId: editor.selectedScene!.id,
                videoConfigId: configId,
              }),
            });
            if (!res.ok) throw new Error("视频生成失败");
            return res.json();
          };

          if (mode === "PARALLEL") {
            await Promise.allSettled(
              configs.map((config) => generateOne(config.configId))
            );
          } else {
            for (const config of configs) {
              await generateOne(config.configId).catch(() => {});
            }
          }
          generation.invalidateProject();
        }}
      />
      <MultiGenerateDialog
        category="TTS"
        isOpen={showMultiAudioDialog}
        onClose={() => setShowMultiAudioDialog(false)}
        onGenerate={async (configs, mode) => {
          const text =
            editor.selectedScene?.dialogue || editor.selectedScene?.narration;
          if (!text) return;
          setShowMultiAudioDialog(false);

          // 通过 characterId 让服务端从 Character.voiceId 解析音色
          const characterId =
            editor.selectedScene?.selectedCharacter?.id ??
            editor.selectedScene?.selectedCharacterId ??
            undefined;

          const generateOne = async (configId?: string) => {
            const res = await fetch("/api/generate/tts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                characterId,
                speed: 1.0,
                projectId,
                sceneId: editor.selectedScene!.id,
                ttsConfigId: configId,
              }),
            });
            if (!res.ok) throw new Error("配音生成失败");
            return res.json();
          };

          if (mode === "PARALLEL") {
            await Promise.allSettled(
              configs.map((config) => generateOne(config.configId))
            );
          } else {
            for (const config of configs) {
              await generateOne(config.configId).catch(() => {});
            }
          }
          generation.invalidateProject();
        }}
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
