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
import type { Scene, ProjectDetail } from "@/types";
import type { UseMutationResult } from "@tanstack/react-query";

interface SceneListProps {
  project: ProjectDetail;
  selectedSceneId: string | null;
  onSceneSelect: (id: string) => void;
  onManageCharacters: () => void;
  generateImageMutation: UseMutationResult<unknown, Error, { sceneId: string; scene: Scene }>;
  generateVideoMutation: UseMutationResult<unknown, Error, { sceneId: string; scene: Scene }>;
  generateAudioMutation: UseMutationResult<unknown, Error, { sceneId: string; scene: Scene }>;
  batchGenerateImagesMutation?: UseMutationResult<unknown, Error, { scenes: Scene[] }>;
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
  queryClient,
  projectId,
}: SceneListProps) {
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
    <div className="w-1/3 border-r border-gray-800 flex flex-col">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">分镜列表</h2>
          <button
            onClick={onManageCharacters}
            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition"
            title="管理项目角色"
          >
            <Users size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {batchGenerateImagesMutation && project.scenes.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const scenesWithoutImage = project.scenes.filter((s) => !s.imageUrl && s.imageStatus !== "PROCESSING");
                if (scenesWithoutImage.length === 0) {
                  const all = confirm("所有分镜已有图片，是否全部重新生成？");
                  if (all) batchGenerateImagesMutation.mutate({ scenes: project.scenes });
                } else {
                  batchGenerateImagesMutation.mutate({ scenes: scenesWithoutImage });
                }
              }}
              disabled={batchGenerateImagesMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded transition"
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
          <span className="text-sm text-gray-400">{project.scenes.length} 个分镜</span>
        </div>
      </div>
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {project.scenes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500">
            <div className="text-4xl mb-4">🎬</div>
            <p>暂无分镜</p>
            <p className="text-sm">输入文本后点击&ldquo;智能拆解&rdquo;</p>
          </div>
        ) : (
          project.scenes.map((scene, index) => (
            <div
              key={scene.id}
              className={`bg-gray-800 rounded-lg overflow-hidden cursor-pointer transition ${
                selectedSceneId === scene.id ? "ring-2 ring-blue-500" : "hover:bg-gray-750"
              }`}
              onClick={() => onSceneSelect(scene.id)}
            >
              {/* Scene Header */}
              <div className="p-3 flex items-start gap-3">
                <div className="text-gray-500 mt-1">
                  <GripVertical size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-gray-700 px-2 py-0.5 rounded">#{index + 1}</span>
                    <span className="text-xs text-gray-400">{scene.shotType || "中景"}</span>
                    <span className="text-xs text-gray-400">{scene.duration}s</span>
                  </div>
                  <p className="text-sm text-gray-300 line-clamp-2">{scene.description}</p>
                </div>
                <div className="w-16 h-16 bg-gray-700 rounded shrink-0 flex items-center justify-center overflow-hidden">
                  {scene.imageStatus === "PROCESSING" ? (
                    <Loader2 size={20} className="animate-spin text-gray-400" />
                  ) : scene.imageUrl ? (
                    <img src={scene.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={20} className="text-gray-500" />
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {expandedScenes.has(scene.id) && (
                <div className="px-3 pb-3 border-t border-gray-700 pt-3 space-y-2">
                  <div className="flex items-start gap-2 text-sm">
                    <User size={14} className="text-gray-500 mt-1" />
                    <span className="text-gray-500 mt-0.5">角色:</span>
                    {project.characters.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {project.characters.map(({ character }) => {
                          const isSelected = scene.selectedCharacterIds?.includes(character.id);
                          return (
                            <button
                              key={character.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                const currentIds = scene.selectedCharacterIds || [];
                                const newIds = isSelected
                                  ? currentIds.filter((id: string) => id !== character.id)
                                  : [...currentIds, character.id];
                                updateScene(scene.id, { selectedCharacterIds: newIds });
                              }}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition ${
                                isSelected
                                  ? "bg-purple-600 text-white"
                                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                              }`}
                            >
                              {character.referenceImages?.[0] && (
                                <img
                                  src={character.referenceImages[0]}
                                  alt=""
                                  className="w-5 h-5 rounded-full object-cover"
                                />
                              )}
                              {character.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-gray-500">
                        请先
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onManageCharacters();
                          }}
                          className="text-blue-400 hover:underline mx-1"
                        >
                          添加项目角色
                        </button>
                      </span>
                    )}
                  </div>
                  {scene.dialogue && (
                    <div className="text-sm">
                      <span className="text-gray-500">对话: </span>
                      <span className="text-gray-300">{scene.dialogue}</span>
                    </div>
                  )}
                  {scene.narration && (
                    <div className="text-sm">
                      <span className="text-gray-500">旁白: </span>
                      <span className="text-gray-300">{scene.narration}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="px-3 pb-3 flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSceneExpand(scene.id);
                  }}
                  className="p-1 hover:bg-gray-700 rounded"
                >
                  {expandedScenes.has(scene.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <div className="flex-1" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    generateImageMutation.mutate({ sceneId: scene.id, scene });
                  }}
                  disabled={scene.imageStatus === "PROCESSING" || generateImageMutation.isPending}
                  className="p-1.5 hover:bg-gray-700 rounded disabled:opacity-50"
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
                  disabled={!scene.imageUrl || scene.videoStatus === "PROCESSING" || generateVideoMutation.isPending}
                  className="p-1.5 hover:bg-gray-700 rounded disabled:opacity-50"
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
                  className="p-1.5 hover:bg-gray-700 rounded disabled:opacity-50"
                  title={!scene.dialogue && !scene.narration ? "没有对话或旁白" : "生成配音"}
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
        <div className="p-4 border-t border-gray-800 space-y-3">
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
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50"
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
                  if (scene.imageUrl && !scene.videoUrl && scene.videoStatus !== "PROCESSING") {
                    generateVideoMutation.mutate({ sceneId: scene.id, scene });
                  }
                });
              }}
              disabled={generateVideoMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50"
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
                  if ((scene.dialogue || scene.narration) && !scene.audioUrl && scene.audioStatus !== "PROCESSING") {
                    generateAudioMutation.mutate({ sceneId: scene.id, scene });
                  }
                });
              }}
              disabled={generateAudioMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50"
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
