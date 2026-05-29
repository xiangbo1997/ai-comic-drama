"use client";

import { useState } from "react";
import {
  Image as ImageIcon,
  Video,
  Volume2,
  Loader2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  User,
  Users,
  Wand2,
} from "lucide-react";
import { ModelSelector } from "@/components/ai-models";
import { useToast } from "@/components/ui/toast";
import type { Scene, ProjectDetail } from "@/types";
import type { UseMutationResult } from "@tanstack/react-query";

interface SceneListProps {
  project: ProjectDetail;
  selectedSceneId: string | null;
  onSceneSelect: (id: string) => void;
  onManageCharacters: () => void;
  generateImageMutation: UseMutationResult<
    unknown,
    Error,
    { sceneId: string; scene: Scene }
  >;
  generateVideoMutation: UseMutationResult<
    unknown,
    Error,
    { sceneId: string; scene: Scene }
  >;
  generateAudioMutation: UseMutationResult<
    unknown,
    Error,
    { sceneId: string; scene: Scene }
  >;
  batchGenerateImagesMutation?: UseMutationResult<
    unknown,
    Error,
    { scenes: Scene[] }
  >;
  updateScene: (sceneId: string, data: Partial<Scene>) => void;
  selectedImageConfig?: string;
  selectedVideoConfig?: string;
  selectedAudioConfig?: string;
  onImageConfigChange: (id: string | undefined) => void;
  onVideoConfigChange: (id: string | undefined) => void;
  onAudioConfigChange: (id: string | undefined) => void;
  onOpenMultiImageDialog: () => void;
  onOpenMultiVideoDialog: () => void;
  onOpenMultiAudioDialog: () => void;
  queryClient: { invalidateQueries: (opts: { queryKey: string[] }) => void };
  projectId: string;
}

export function SceneList({
  project,
  selectedSceneId,
  onSceneSelect,
  onManageCharacters,
  generateImageMutation,
  generateVideoMutation,
  generateAudioMutation,
  batchGenerateImagesMutation,
  updateScene,
  selectedImageConfig,
  selectedVideoConfig,
  selectedAudioConfig,
  onImageConfigChange,
  onVideoConfigChange,
  onAudioConfigChange,
  onOpenMultiImageDialog,
  onOpenMultiVideoDialog,
  onOpenMultiAudioDialog,
}: SceneListProps) {
  const toast = useToast();
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());

  const toggleSceneExpand = (sceneId: string) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) {
        next.delete(sceneId);
      } else {
        next.add(sceneId);
      }
      return next;
    });
  };

  return (
    <div className="border-border flex w-1/3 flex-col border-r">
      <div className="border-border flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">分镜列表</h2>
          <button
            onClick={onManageCharacters}
            className="text-muted-foreground hover:bg-secondary rounded p-1.5 transition hover:text-white"
            title="管理项目角色"
          >
            <Users size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {batchGenerateImagesMutation && project.scenes.length > 0 && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const scenesWithoutImage = project.scenes.filter(
                  (s) => !s.imageUrl && s.imageStatus !== "PROCESSING"
                );
                if (scenesWithoutImage.length === 0) {
                  const all =
                    await toast.confirm("所有分镜已有图片，是否全部重新生成？");
                  if (all)
                    batchGenerateImagesMutation.mutate({
                      scenes: project.scenes,
                    });
                } else {
                  batchGenerateImagesMutation.mutate({
                    scenes: scenesWithoutImage,
                  });
                }
              }}
              disabled={batchGenerateImagesMutation.isPending}
              className="bg-primary hover:bg-primary/90 flex items-center gap-1 rounded px-2 py-1 text-xs transition disabled:opacity-50"
              title="批量生成所有缺失图片的分镜"
            >
              {batchGenerateImagesMutation.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Wand2 size={12} />
              )}
              批量生成
            </button>
          )}
          <span className="text-muted-foreground text-sm">
            {project.scenes.length} 个分镜
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {project.scenes.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center">
            <div className="mb-4 text-4xl">🎬</div>
            <p>暂无分镜</p>
            <p className="text-sm">输入文本后点击&ldquo;智能拆解&rdquo;</p>
          </div>
        ) : (
          project.scenes.map((scene, index) => (
            <div
              key={scene.id}
              className={`bg-card cursor-pointer overflow-hidden rounded-lg transition ${
                selectedSceneId === scene.id
                  ? "ring-primary ring-2"
                  : "hover:bg-secondary"
              }`}
              onClick={() => onSceneSelect(scene.id)}
            >
              {/* Scene Header */}
              <div className="flex items-start gap-3 p-3">
                <div className="text-muted-foreground mt-1">
                  <GripVertical size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="bg-secondary rounded px-2 py-0.5 text-xs">
                      #{index + 1}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {scene.shotType || "中景"}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {scene.duration}s
                    </span>
                  </div>
                  <p className="text-foreground line-clamp-2 text-sm">
                    {scene.description}
                  </p>
                </div>
                <div className="bg-secondary flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded">
                  {scene.imageStatus === "PROCESSING" ? (
                    <Loader2
                      size={20}
                      className="text-muted-foreground animate-spin"
                    />
                  ) : scene.imageUrl ? (
                    <img
                      src={scene.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon size={20} className="text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {expandedScenes.has(scene.id) && (
                <div className="border-border space-y-2 border-t px-3 pt-3 pb-3">
                  <div className="flex items-start gap-2 text-sm">
                    <User size={14} className="text-muted-foreground mt-1" />
                    <span className="text-muted-foreground mt-0.5">角色:</span>
                    {project.characters.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {project.characters.map(({ character }) => {
                          const isSelected =
                            scene.selectedCharacterIds?.includes(character.id);
                          return (
                            <button
                              key={character.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                const currentIds =
                                  scene.selectedCharacterIds || [];
                                const newIds = isSelected
                                  ? currentIds.filter(
                                      (id: string) => id !== character.id
                                    )
                                  : [...currentIds, character.id];
                                updateScene(scene.id, {
                                  selectedCharacterIds: newIds,
                                });
                              }}
                              className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
                                isSelected
                                  ? "bg-purple-600 text-white"
                                  : "bg-secondary text-foreground hover:bg-secondary/80"
                              }`}
                            >
                              {character.referenceImages?.[0] && (
                                <img
                                  src={character.referenceImages[0]}
                                  alt=""
                                  className="h-5 w-5 rounded-full object-cover"
                                />
                              )}
                              {character.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        请先
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onManageCharacters();
                          }}
                          className="text-primary mx-1 hover:underline"
                        >
                          添加项目角色
                        </button>
                      </span>
                    )}
                  </div>
                  {scene.dialogue && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">对话: </span>
                      <span className="text-foreground">{scene.dialogue}</span>
                    </div>
                  )}
                  {scene.narration && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">旁白: </span>
                      <span className="text-foreground">{scene.narration}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 px-3 pb-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSceneExpand(scene.id);
                  }}
                  className="hover:bg-secondary rounded p-1"
                >
                  {expandedScenes.has(scene.id) ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </button>
                <div className="flex-1" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    generateImageMutation.mutate({ sceneId: scene.id, scene });
                  }}
                  disabled={
                    scene.imageStatus === "PROCESSING" ||
                    generateImageMutation.isPending
                  }
                  className="hover:bg-secondary rounded p-1.5 disabled:opacity-50"
                  title="生成图片"
                >
                  {scene.imageStatus === "PROCESSING" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ImageIcon size={14} />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    generateVideoMutation.mutate({ sceneId: scene.id, scene });
                  }}
                  disabled={
                    !scene.imageUrl ||
                    scene.videoStatus === "PROCESSING" ||
                    generateVideoMutation.isPending
                  }
                  className="hover:bg-secondary rounded p-1.5 disabled:opacity-50"
                  title={!scene.imageUrl ? "请先生成图片" : "生成视频"}
                >
                  {scene.videoStatus === "PROCESSING" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Video size={14} />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    generateAudioMutation.mutate({ sceneId: scene.id, scene });
                  }}
                  disabled={
                    (!scene.dialogue && !scene.narration) ||
                    scene.audioStatus === "PROCESSING" ||
                    generateAudioMutation.isPending
                  }
                  className="hover:bg-secondary rounded p-1.5 disabled:opacity-50"
                  title={
                    !scene.dialogue && !scene.narration
                      ? "没有对话或旁白"
                      : "生成配音"
                  }
                >
                  {scene.audioStatus === "PROCESSING" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Volume2 size={14} />
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Batch Actions */}
      {project.scenes.length > 0 && (
        <div className="border-border space-y-3 border-t p-4">
          <div className="flex items-center gap-2">
            <ModelSelector
              category="IMAGE"
              value={selectedImageConfig}
              onChange={onImageConfigChange}
              onOpenMultiSelect={onOpenMultiImageDialog}
              showMultiSelectButton
              size="sm"
            />
            <button
              onClick={() => {
                project.scenes.forEach((scene) => {
                  if (!scene.imageUrl && scene.imageStatus !== "PROCESSING") {
                    generateImageMutation.mutate({ sceneId: scene.id, scene });
                  }
                });
              }}
              disabled={generateImageMutation.isPending}
              className="bg-secondary hover:bg-secondary/80 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <ImageIcon size={16} />
              批量图片
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ModelSelector
              category="VIDEO"
              value={selectedVideoConfig}
              onChange={onVideoConfigChange}
              onOpenMultiSelect={onOpenMultiVideoDialog}
              showMultiSelectButton
              size="sm"
            />
            <button
              onClick={() => {
                project.scenes.forEach((scene) => {
                  if (
                    scene.imageUrl &&
                    !scene.videoUrl &&
                    scene.videoStatus !== "PROCESSING"
                  ) {
                    generateVideoMutation.mutate({ sceneId: scene.id, scene });
                  }
                });
              }}
              disabled={generateVideoMutation.isPending}
              className="bg-secondary hover:bg-secondary/80 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <Video size={16} />
              批量视频
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ModelSelector
              category="TTS"
              value={selectedAudioConfig}
              onChange={onAudioConfigChange}
              onOpenMultiSelect={onOpenMultiAudioDialog}
              showMultiSelectButton
              size="sm"
            />
            <button
              onClick={() => {
                project.scenes.forEach((scene) => {
                  if (
                    (scene.dialogue || scene.narration) &&
                    !scene.audioUrl &&
                    scene.audioStatus !== "PROCESSING"
                  ) {
                    generateAudioMutation.mutate({ sceneId: scene.id, scene });
                  }
                });
              }}
              disabled={generateAudioMutation.isPending}
              className="bg-secondary hover:bg-secondary/80 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <Volume2 size={16} />
              批量配音
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
