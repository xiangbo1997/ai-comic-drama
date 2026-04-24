"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
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
import { SceneList } from "./components/SceneList";
import { SceneEditor } from "./components/SceneEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { ExportDialog } from "./components/ExportDialog";
import { CharacterManagerDialog } from "./components/CharacterManagerDialog";
import { WorkflowPanel } from "./components/WorkflowPanel";
import { useWorkflow } from "./hooks/use-workflow";

export default function EditorPage() {
  const params = useParams();
  const projectId = params.id as string;

  // 项目数据 & 操作
  const editor = useEditorProject(projectId);
  const generation = useGenerationActions(projectId, editor.project);
  const workflow = useWorkflow(projectId);

  // UI 状态
  const [showSettings, setShowSettings] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
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
  }>({ isExporting: false, taskId: null, progress: 0, error: null });

  // 导出视频
  const handleExport = async (options: {
    format: string;
    quality: string;
    includeSubtitles: boolean;
    includeAudio: boolean;
  }) => {
    setExportStatus({
      isExporting: true,
      taskId: null,
      progress: 0,
      error: null,
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
        });
        window.open(videoUrl, "_blank");
        setShowExportDialog(false);
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
      });
    }
  };

  const pollExportProgress = async (taskId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/export?taskId=${taskId}`
        );
        const data = await res.json();

        if (data.status === "completed") {
          setExportStatus({
            isExporting: false,
            taskId: null,
            progress: 100,
            error: null,
          });
          if (data.videoUrl) window.open(data.videoUrl, "_blank");
          setShowExportDialog(false);
        } else if (data.status === "failed") {
          setExportStatus({
            isExporting: false,
            taskId: null,
            progress: 0,
            error: data.error || "导出失败",
          });
        } else {
          setExportStatus((prev) => ({
            ...prev,
            progress: data.progress || 0,
          }));
          setTimeout(poll, 2000);
        }
      } catch {
        setExportStatus({
          isExporting: false,
          taskId: null,
          progress: 0,
          error: "获取进度失败",
        });
      }
    };
    poll();
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

  const handleUpdateSceneFromList = (
    sceneId: string,
    data: Record<string, unknown>
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiUpdateScene(projectId, sceneId, data as any).then(() =>
      editor.invalidateProject()
    );
  };

  // Loading / Error states
  if (projectId === "new" || editor.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (editor.error || !editor.project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <p className="mb-4 text-red-400">项目加载失败</p>
          <Link href="/projects" className="text-blue-400 hover:underline">
            返回项目列表
          </Link>
        </div>
      </div>
    );
  }

  const { project } = editor;

  return (
    <div className="flex min-h-screen flex-col bg-gray-900 text-white">
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
          selectedImageConfig={selectedImageConfig}
          selectedVideoConfig={selectedVideoConfig}
          selectedAudioConfig={selectedAudioConfig}
          onImageConfigChange={setSelectedImageConfig}
          onVideoConfigChange={setSelectedVideoConfig}
          onAudioConfigChange={setSelectedAudioConfig}
          onOpenMultiImageDialog={() => setShowMultiImageDialog(true)}
          onOpenMultiVideoDialog={() => setShowMultiVideoDialog(true)}
          onOpenMultiAudioDialog={() => setShowMultiAudioDialog(true)}
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
        />
      )}

      {/* Preview Dialog */}
      {showPreviewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <h2 className="text-xl font-semibold">预览播放</h2>
              <button
                onClick={() => setShowPreviewDialog(false)}
                className="rounded-lg p-2 transition hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <PreviewPlayer
                scenes={project.scenes}
                aspectRatio={project.aspectRatio}
                onSceneChange={editor.setSelectedSceneId}
                currentSceneId={editor.selectedSceneId ?? undefined}
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
        onClose={() => setShowExportDialog(false)}
        onRetry={() =>
          setExportStatus({
            isExporting: false,
            taskId: null,
            progress: 0,
            error: null,
          })
        }
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

          const generateOne = async () => {
            const res = await fetch("/api/generate/video", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageUrl: editor.selectedScene!.imageUrl,
                prompt: editor.selectedScene!.description,
                duration: editor.selectedScene!.duration > 5 ? 10 : 5,
                projectId,
                sceneId: editor.selectedScene!.id,
              }),
            });
            if (!res.ok) throw new Error("视频生成失败");
            return res.json();
          };

          if (mode === "PARALLEL") {
            await Promise.allSettled(configs.map(() => generateOne()));
          } else {
            // TODO: generateOne 未使用 config 参数，这里实际是串行 N 次相同调用
            for (let i = 0; i < configs.length; i++) {
              await generateOne().catch(() => {});
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

          const generateOne = async () => {
            const res = await fetch("/api/generate/tts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                voiceId: "default",
                speed: 1.0,
                projectId,
                sceneId: editor.selectedScene!.id,
              }),
            });
            if (!res.ok) throw new Error("配音生成失败");
            return res.json();
          };

          if (mode === "PARALLEL") {
            await Promise.allSettled(configs.map(() => generateOne()));
          } else {
            // TODO: generateOne 未使用 config 参数，这里实际是串行 N 次相同调用
            for (let i = 0; i < configs.length; i++) {
              await generateOne().catch(() => {});
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
