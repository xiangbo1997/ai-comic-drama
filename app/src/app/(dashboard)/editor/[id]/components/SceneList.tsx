"use client";

import { useState, memo } from "react";
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
  AlertCircle,
  RotateCw,
  List,
  LayoutGrid,
  Grid3x3,
  MoreVertical,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import { ModelSelector } from "@/components/ai-models";
import { useToast } from "@/components/ui/toast";
import type { Scene, ProjectDetail } from "@/types";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableItem } from "./SortableItem";

/** 单个媒体类型（图/视/音）的配置控制三元组 */
export interface MediaConfigControl {
  /** 当前选中的 AI 配置 ID */
  selected?: string;
  /** 切换配置 */
  onChange: (id: string | undefined) => void;
  /** 打开多配置批量生成对话框 */
  onOpenMultiSelect: () => void;
}

/** 图/视/音三类媒体配置控制集合（收口原先分散的 9 个 props） */
export interface MediaConfigControls {
  image: MediaConfigControl;
  video: MediaConfigControl;
  audio: MediaConfigControl;
}

interface SceneListProps {
  project: ProjectDetail;
  selectedSceneId: string | null;
  onSceneSelect: (id: string) => void;
  onManageCharacters: () => void;
  generateImageMutation: UseMutationResult<
    unknown,
    Error,
    { sceneId: string; scene: Scene; imageConfigId?: string }
  >;
  generateVideoMutation: UseMutationResult<
    unknown,
    Error,
    { sceneId: string; scene: Scene; videoConfigId?: string }
  >;
  generateAudioMutation: UseMutationResult<
    unknown,
    Error,
    { sceneId: string; scene: Scene; ttsConfigId?: string }
  >;
  batchGenerateImagesMutation?: UseMutationResult<
    unknown,
    Error,
    { scenes: Scene[]; imageConfigId?: string }
  >;
  updateScene: (sceneId: string, data: Partial<Scene>) => void;
  /** 图/视/音三类媒体配置控制（收口原先 9 个分散 props） */
  mediaConfig: MediaConfigControls;
  queryClient: { invalidateQueries: (opts: { queryKey: string[] }) => void };
  projectId: string;
}

function SceneListImpl({
  project,
  selectedSceneId,
  onSceneSelect,
  onManageCharacters,
  generateImageMutation,
  generateVideoMutation,
  generateAudioMutation,
  batchGenerateImagesMutation,
  updateScene,
  mediaConfig,
  queryClient,
  projectId,
}: SceneListProps) {
  const toast = useToast();
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  // 视图密度：列表 / 2 列网格 / 3 列网格
  const [viewMode, setViewMode] = useState<"list" | "grid2" | "grid3">("list");
  // 当前打开三点菜单的分镜 id
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const refreshProject = () =>
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  // 复制分镜
  const handleDuplicateScene = async (sceneId: string) => {
    setOpenMenuId(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/duplicate`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error();
      refreshProject();
      toast.success("已复制分镜");
    } catch {
      toast.error("复制分镜失败");
    }
  };

  // 在指定分镜后插入空白分镜
  const handleInsertScene = async (afterSceneId: string) => {
    setOpenMenuId(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterSceneId }),
      });
      if (!res.ok) throw new Error();
      refreshProject();
      toast.success("已插入新分镜");
    } catch {
      toast.error("插入分镜失败");
    }
  };

  // 删除分镜（需确认）
  const handleDeleteScene = async (sceneId: string) => {
    setOpenMenuId(null);
    const ok = await toast.confirm("确定删除这个分镜？此操作不可撤销。");
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      refreshProject();
      toast.success("已删除分镜");
    } catch {
      toast.error("删除分镜失败");
    }
  };

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

  // 拖拽传感器：8px 移动阈值，避免点击卡片被误判为拖拽
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // 拖拽结束 → 计算新顺序 → 调 reorder API → 刷新
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = project.scenes.map((s) => s.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    // 本地计算新顺序（用于发送给服务端）
    const reordered = [...ids];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered }),
      });
      if (!res.ok) throw new Error("排序保存失败");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    } catch {
      toast.error("分镜排序保存失败");
    }
  };

  return (
    <div className="border-border flex min-w-0 flex-1 flex-col border-r">
      <div className="border-border flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">分镜列表</h2>
          <button
            onClick={onManageCharacters}
            className="text-muted-foreground hover:bg-secondary hover:text-foreground rounded p-1.5 transition"
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
                      imageConfigId: mediaConfig.image.selected,
                      scenes: project.scenes,
                    });
                } else {
                  batchGenerateImagesMutation.mutate({
                    imageConfigId: mediaConfig.image.selected,
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
          {/* 视图密度切换：列表 / 2 列 / 3 列 */}
          <div className="bg-secondary flex items-center gap-0.5 rounded p-0.5">
            {(
              [
                ["list", List],
                ["grid2", LayoutGrid],
                ["grid3", Grid3x3],
              ] as const
            ).map(([mode, Icon]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`rounded p-1 transition ${
                  viewMode === mode
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={
                  mode === "list" ? "列表" : mode === "grid2" ? "2 列" : "3 列"
                }
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <span className="text-muted-foreground text-sm">
            {project.scenes.length} 个分镜
          </span>
        </div>
      </div>
      <div
        className={`flex-1 overflow-y-auto p-4 ${
          viewMode === "list"
            ? "space-y-3"
            : viewMode === "grid2"
              ? "grid grid-cols-2 gap-3"
              : "grid grid-cols-3 gap-3"
        }`}
      >
        {project.scenes.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center">
            <div className="mb-4 text-4xl">🎬</div>
            <p>暂无分镜</p>
            <p className="text-sm">输入文本后点击&ldquo;智能拆解&rdquo;</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={project.scenes.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {project.scenes.map((scene, index) => (
                <SortableItem key={scene.id} id={scene.id}>
                  {({ attributes, listeners, isDragging }) => (
                    <div
                      className={`bg-card cursor-pointer overflow-hidden rounded-lg transition ${
                        isDragging ? "shadow-lg" : ""
                      } ${
                        selectedSceneId === scene.id
                          ? "ring-primary ring-2"
                          : "hover:bg-secondary"
                      }`}
                      onClick={() => onSceneSelect(scene.id)}
                    >
                      {/* Scene Header */}
                      <div className="flex items-start gap-3 p-3">
                        <button
                          type="button"
                          className="text-muted-foreground mt-1 cursor-grab touch-none active:cursor-grabbing"
                          title="拖拽调整顺序"
                          onClick={(e) => e.stopPropagation()}
                          {...attributes}
                          {...listeners}
                        >
                          <GripVertical size={16} />
                        </button>
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
                        <div className="bg-secondary relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded">
                          {/* 三状态角标：生成中 / 完成 / 失败 */}
                          <SceneStatusBadge
                            status={scene.imageStatus}
                            hasImage={!!scene.imageUrl}
                          />
                          {scene.imageStatus === "PROCESSING" ? (
                            <div className="bg-secondary h-full w-full animate-pulse" />
                          ) : scene.imageStatus === "FAILED" &&
                            !scene.imageUrl ? (
                            <AlertCircle
                              size={20}
                              className="text-destructive"
                            />
                          ) : scene.imageUrl ? (
                            <img
                              src={scene.imageUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon
                              size={20}
                              className="text-muted-foreground"
                            />
                          )}
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {expandedScenes.has(scene.id) && (
                        <div className="border-border space-y-2 border-t px-3 pt-3 pb-3">
                          <div className="flex items-start gap-2 text-sm">
                            <User
                              size={14}
                              className="text-muted-foreground mt-1"
                            />
                            <span className="text-muted-foreground mt-0.5">
                              角色:
                            </span>
                            {project.characters.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {project.characters.map(({ character }) => {
                                  const isSelected =
                                    scene.selectedCharacterIds?.includes(
                                      character.id
                                    );
                                  return (
                                    <button
                                      key={character.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const currentIds =
                                          scene.selectedCharacterIds || [];
                                        const newIds = isSelected
                                          ? currentIds.filter(
                                              (id: string) =>
                                                id !== character.id
                                            )
                                          : [...currentIds, character.id];
                                        updateScene(scene.id, {
                                          selectedCharacterIds: newIds,
                                        });
                                      }}
                                      className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
                                        isSelected
                                          ? "text-foreground bg-purple-600"
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
                              <span className="text-muted-foreground">
                                对话:{" "}
                              </span>
                              <span className="text-foreground">
                                {scene.dialogue}
                              </span>
                            </div>
                          )}
                          {scene.narration && (
                            <div className="text-sm">
                              <span className="text-muted-foreground">
                                旁白:{" "}
                              </span>
                              <span className="text-foreground">
                                {scene.narration}
                              </span>
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
                        {/* 三点菜单：复制 / 插入 / 删除 */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(
                                openMenuId === scene.id ? null : scene.id
                              );
                            }}
                            className="hover:bg-secondary rounded p-1"
                            title="更多操作"
                          >
                            <MoreVertical size={14} />
                          </button>
                          {openMenuId === scene.id && (
                            <>
                              {/* 点击外部关闭 */}
                              <div
                                className="fixed inset-0 z-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(null);
                                }}
                              />
                              <div className="bg-card border-border absolute top-7 left-0 z-20 w-32 overflow-hidden rounded-lg border shadow-lg">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDuplicateScene(scene.id);
                                  }}
                                  className="hover:bg-secondary flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                                >
                                  <Copy size={13} />
                                  复制分镜
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleInsertScene(scene.id);
                                  }}
                                  className="hover:bg-secondary flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                                >
                                  <Plus size={13} />
                                  下方插入
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteScene(scene.id);
                                  }}
                                  className="text-destructive flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-red-500/10"
                                >
                                  <Trash2 size={13} />
                                  删除分镜
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex-1" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            generateImageMutation.mutate({
                              sceneId: scene.id,
                              scene,
                              imageConfigId: mediaConfig.image.selected,
                            });
                          }}
                          disabled={
                            scene.imageStatus === "PROCESSING" ||
                            generateImageMutation.isPending
                          }
                          className="hover:bg-secondary rounded p-1.5 disabled:opacity-50"
                          title={
                            scene.imageStatus === "FAILED"
                              ? "图片生成失败，点击重试"
                              : "生成图片"
                          }
                        >
                          {scene.imageStatus === "PROCESSING" ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : scene.imageStatus === "FAILED" ? (
                            <RotateCw size={14} className="text-destructive" />
                          ) : (
                            <ImageIcon size={14} />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            generateVideoMutation.mutate({
                              sceneId: scene.id,
                              scene,
                              videoConfigId: mediaConfig.video.selected,
                            });
                          }}
                          disabled={
                            !scene.imageUrl ||
                            scene.videoStatus === "PROCESSING" ||
                            generateVideoMutation.isPending
                          }
                          className="hover:bg-secondary rounded p-1.5 disabled:opacity-50"
                          title={
                            !scene.imageUrl
                              ? "请先生成图片"
                              : scene.videoStatus === "FAILED"
                                ? "视频生成失败，点击重试"
                                : "生成视频"
                          }
                        >
                          {scene.videoStatus === "PROCESSING" ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : scene.videoStatus === "FAILED" ? (
                            <RotateCw size={14} className="text-destructive" />
                          ) : (
                            <Video size={14} />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            generateAudioMutation.mutate({
                              sceneId: scene.id,
                              scene,
                              ttsConfigId: mediaConfig.audio.selected,
                            });
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
                              : scene.audioStatus === "FAILED"
                                ? "配音生成失败，点击重试"
                                : "生成配音"
                          }
                        >
                          {scene.audioStatus === "PROCESSING" ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : scene.audioStatus === "FAILED" ? (
                            <RotateCw size={14} className="text-destructive" />
                          ) : (
                            <Volume2 size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </SortableItem>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Batch Actions */}
      {project.scenes.length > 0 && (
        <div className="border-border space-y-3 border-t p-4">
          <div className="flex items-center gap-2">
            <ModelSelector
              category="IMAGE"
              value={mediaConfig.image.selected}
              onChange={mediaConfig.image.onChange}
              onOpenMultiSelect={mediaConfig.image.onOpenMultiSelect}
              showMultiSelectButton
              size="sm"
            />
            <button
              onClick={() => {
                project.scenes.forEach((scene) => {
                  if (!scene.imageUrl && scene.imageStatus !== "PROCESSING") {
                    generateImageMutation.mutate({
                      sceneId: scene.id,
                      scene,
                      imageConfigId: mediaConfig.image.selected,
                    });
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
              value={mediaConfig.video.selected}
              onChange={mediaConfig.video.onChange}
              onOpenMultiSelect={mediaConfig.video.onOpenMultiSelect}
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
                    generateVideoMutation.mutate({
                      sceneId: scene.id,
                      scene,
                      videoConfigId: mediaConfig.video.selected,
                    });
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
              value={mediaConfig.audio.selected}
              onChange={mediaConfig.audio.onChange}
              onOpenMultiSelect={mediaConfig.audio.onOpenMultiSelect}
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
                    generateAudioMutation.mutate({
                      sceneId: scene.id,
                      scene,
                      ttsConfigId: mediaConfig.audio.selected,
                    });
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

/**
 * 分镜缩略图三状态角标（对标 Boords/AI Storyboard pipeline 的 Queued/Generating/Ready）。
 * 叠在缩略图右上角，克制小巧，不喧宾夺主。
 */
function SceneStatusBadge({
  status,
  hasImage,
}: {
  status?: string | null;
  hasImage: boolean;
}) {
  if (status === "PROCESSING") {
    return (
      <span className="bg-primary/90 text-primary-foreground absolute top-1 right-1 z-10 flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-none">
        <span className="bg-primary-foreground inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
        生成中
      </span>
    );
  }
  if (status === "FAILED" && !hasImage) {
    return (
      <span className="bg-destructive/90 absolute top-1 right-1 z-10 rounded px-1 py-0.5 text-[10px] leading-none text-white">
        失败
      </span>
    );
  }
  if (hasImage) {
    return (
      <span className="absolute top-1 right-1 z-10 flex items-center gap-1 rounded bg-green-600/90 px-1 py-0.5 text-[10px] leading-none text-white">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" />
        就绪
      </span>
    );
  }
  return null;
}

// memo：分镜列表含 20+ 卡片，避免编辑器顶层弹窗 state 变化时整列表重渲染。
export const SceneList = memo(SceneListImpl);
