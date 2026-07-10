"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import {
  Image as ImageIcon,
  Video,
  Volume2,
  Loader2,
  RotateCw,
  Users,
  Wand2,
  List,
  LayoutGrid,
  Grid3x3,
  Film,
} from "lucide-react";
import { ModelSelector } from "@/components/ai-models";
import { useToast } from "@/components/ui/toast";
import type { BatchProgress } from "../hooks/use-generation-actions";
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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { SceneCard } from "./SceneCard";
import { SceneVideoDialog } from "./SceneVideoDialog";

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
  batchGenerateVideosMutation?: UseMutationResult<
    unknown,
    Error,
    { scenes: Scene[]; videoConfigId?: string }
  >;
  batchGenerateAudiosMutation?: UseMutationResult<
    unknown,
    Error,
    { scenes: Scene[]; ttsConfigId?: string }
  >;
  /** 当前批量进度（无批量运行时为 null） */
  batchProgress?: BatchProgress | null;
  /** 停止批量的后续排队（已发出的请求会继续完成） */
  onCancelBatch?: () => void;
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
  batchGenerateVideosMutation,
  batchGenerateAudiosMutation,
  batchProgress,
  onCancelBatch,
  updateScene,
  mediaConfig,
  queryClient,
  projectId,
}: SceneListProps) {
  const toast = useToast();
  // 任一批量在跑时禁用全部批量入口：串行批量互斥，避免图/视/音批量叠加
  const anyBatchPending = Boolean(
    batchGenerateImagesMutation?.isPending ||
    batchGenerateVideosMutation?.isPending ||
    batchGenerateAudiosMutation?.isPending
  );
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  // 视图密度：列表 / 2 列网格 / 3 列网格
  const [viewMode, setViewMode] = useState<"list" | "grid2" | "grid3">("list");
  // 当前打开三点菜单的分镜 id
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // 当前在弹窗查看视频的分镜（null=弹窗关闭）
  const [viewingVideoScene, setViewingVideoScene] = useState<Scene | null>(
    null
  );

  // 选中分镜自动滚动入视（ux-editor P0-2）：从时间轴播放/预览/搜索切换
  // 分镜后，把对应卡片滚到可见区，避免分镜多时用户「丢失当前位置」。
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    if (!selectedSceneId) return;
    itemRefs.current
      .get(selectedSceneId)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedSceneId]);

  const refreshProject = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    [queryClient, projectId]
  );

  // 复制分镜
  const handleDuplicateScene = useCallback(
    async (sceneId: string) => {
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
    },
    [projectId, refreshProject, toast]
  );

  // 在指定分镜后插入空白分镜
  const handleInsertScene = useCallback(
    async (afterSceneId: string) => {
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
    },
    [projectId, refreshProject, toast]
  );

  // 删除分镜（需确认）
  const handleDeleteScene = useCallback(
    async (sceneId: string) => {
      setOpenMenuId(null);
      const ok = await toast.confirm("确定删除这个分镜？此操作不可撤销。");
      if (!ok) return;
      try {
        const res = await fetch(
          `/api/projects/${projectId}/scenes/${sceneId}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error();
        refreshProject();
        toast.success("已删除分镜");
      } catch {
        toast.error("删除分镜失败");
      }
    },
    [projectId, refreshProject, toast]
  );

  const toggleSceneExpand = useCallback((sceneId: string) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) {
        next.delete(sceneId);
      } else {
        next.add(sceneId);
      }
      return next;
    });
  }, []);

  // 供卡片登记 DOM 的稳定回调（内联闭包会每次新引用，击穿卡片 memo）
  const registerItemRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  // 三点菜单开合的稳定回调
  const handleMenuToggle = useCallback((id: string | null) => {
    setOpenMenuId(id);
  }, []);

  // 图/视/音单张生成：mutation.mutate 稳定，仅依赖对应 selected 配置 id
  const handleGenerateImage = useCallback(
    (scene: Scene) => {
      generateImageMutation.mutate({
        sceneId: scene.id,
        scene,
        imageConfigId: mediaConfig.image.selected,
      });
    },
    [generateImageMutation, mediaConfig.image.selected]
  );
  const handleGenerateVideo = useCallback(
    (scene: Scene) => {
      generateVideoMutation.mutate({
        sceneId: scene.id,
        scene,
        videoConfigId: mediaConfig.video.selected,
      });
    },
    [generateVideoMutation, mediaConfig.video.selected]
  );
  const handleGenerateAudio = useCallback(
    (scene: Scene) => {
      generateAudioMutation.mutate({
        sceneId: scene.id,
        scene,
        ttsConfigId: mediaConfig.audio.selected,
      });
    },
    [generateAudioMutation, mediaConfig.audio.selected]
  );
  // 查看该分镜视频（弹窗播放）；稳定引用避免击穿 SceneCard 的 memo
  const handleViewVideo = useCallback((scene: Scene) => {
    setViewingVideoScene(scene);
  }, []);

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
              disabled={anyBatchPending}
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
          {/* 仅补失败镜：workflow 部分成功或批量后有失败时的一键重试入口，
              避免逐张扫红角标手动点（历史遗留候选项） */}
          {batchGenerateImagesMutation &&
            (() => {
              const failedScenes = project.scenes.filter(
                (s) => s.imageStatus === "FAILED"
              );
              if (failedScenes.length === 0) return null;
              return (
                <button
                  onClick={() =>
                    batchGenerateImagesMutation.mutate({
                      scenes: failedScenes,
                      imageConfigId: mediaConfig.image.selected,
                    })
                  }
                  disabled={anyBatchPending}
                  className="bg-destructive/20 text-destructive hover:bg-destructive/30 flex items-center gap-1 rounded px-2 py-1 text-xs transition disabled:opacity-50"
                  title="仅重新生成图片失败的分镜"
                >
                  <RotateCw size={12} />
                  重试失败 {failedScenes.length}
                </button>
              );
            })()}
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
          <div className="flex h-full flex-col items-center justify-center">
            <div className="border-border flex flex-col items-center rounded-xl border border-dashed px-8 py-6 text-center">
              <Film size={40} className="text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm font-medium">
                暂无分镜
              </p>
              <p className="text-muted-foreground/60 mt-1 text-xs">
                粘贴小说文本并点击「智能拆解分镜」
              </p>
            </div>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={project.scenes.map((s) => s.id)}
              // 网格视图用 rectSortingStrategy（二维落点计算），列表用 vertical。
              // 此前写死 vertical，在 grid2/grid3 下拖拽落点按垂直距离算 → 拖到
              // 右侧卡片却重排到别处，"拖了乱跳"的功能性失效（a5 P0-2）。
              strategy={
                viewMode === "list"
                  ? verticalListSortingStrategy
                  : rectSortingStrategy
              }
            >
              {project.scenes.map((scene, index) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  index={index}
                  isSelected={selectedSceneId === scene.id}
                  isExpanded={expandedScenes.has(scene.id)}
                  isMenuOpen={openMenuId === scene.id}
                  viewMode={viewMode}
                  characters={project.characters}
                  onSelect={onSceneSelect}
                  onToggleExpand={toggleSceneExpand}
                  onMenuToggle={handleMenuToggle}
                  onManageCharacters={onManageCharacters}
                  onDuplicate={handleDuplicateScene}
                  onInsert={handleInsertScene}
                  onDelete={handleDeleteScene}
                  onGenerateImage={handleGenerateImage}
                  onGenerateVideo={handleGenerateVideo}
                  onGenerateAudio={handleGenerateAudio}
                  onViewVideo={handleViewVideo}
                  updateScene={updateScene}
                  registerItemRef={registerItemRef}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Batch Actions — 三类批量统一走串行 batch mutation（逐张生成 + 成败
          汇总 + 可停止）。此前底部是并行 forEach 瞬间打出 N 个同步请求：
          易触发限流、无汇总，且与顶部串行「批量生成」语义割裂（ux-editor P1-5） */}
      {project.scenes.length > 0 && (
        <div className="border-border space-y-3 border-t p-4">
          {batchProgress && (
            <div className="bg-secondary/50 flex items-center justify-between rounded-lg px-3 py-2 text-xs">
              <span className="text-muted-foreground flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" />
                批量
                {batchProgress.kind === "image"
                  ? "图片"
                  : batchProgress.kind === "video"
                    ? "视频"
                    : "配音"}
                生成中 {batchProgress.done}/{batchProgress.total}
              </span>
              <button
                onClick={onCancelBatch}
                className="text-destructive hover:underline"
                title="已发出的请求会继续完成，仅停止排队后续分镜"
              >
                停止后续
              </button>
            </div>
          )}
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
                const targets = project.scenes.filter(
                  (s) => !s.imageUrl && s.imageStatus !== "PROCESSING"
                );
                if (targets.length === 0 || !batchGenerateImagesMutation)
                  return;
                batchGenerateImagesMutation.mutate({
                  scenes: targets,
                  imageConfigId: mediaConfig.image.selected,
                });
              }}
              disabled={anyBatchPending}
              className="bg-secondary hover:bg-secondary/80 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <ImageIcon size={16} />
              批量图片
              <span className="text-muted-foreground ml-1 text-xs">
                {project.scenes.filter((s) => s.imageUrl).length}/
                {project.scenes.length}
              </span>
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
                const targets = project.scenes.filter(
                  (s) =>
                    s.imageUrl && !s.videoUrl && s.videoStatus !== "PROCESSING"
                );
                if (targets.length === 0 || !batchGenerateVideosMutation)
                  return;
                batchGenerateVideosMutation.mutate({
                  scenes: targets,
                  videoConfigId: mediaConfig.video.selected,
                });
              }}
              disabled={anyBatchPending}
              className="bg-secondary hover:bg-secondary/80 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <Video size={16} />
              批量视频
              <span className="text-muted-foreground ml-1 text-xs">
                {project.scenes.filter((s) => s.videoUrl).length}/
                {project.scenes.length}
              </span>
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
                const targets = project.scenes.filter(
                  (s) =>
                    (s.dialogue || s.narration) &&
                    !s.audioUrl &&
                    s.audioStatus !== "PROCESSING"
                );
                if (targets.length === 0 || !batchGenerateAudiosMutation)
                  return;
                batchGenerateAudiosMutation.mutate({
                  scenes: targets,
                  ttsConfigId: mediaConfig.audio.selected,
                });
              }}
              disabled={anyBatchPending}
              className="bg-secondary hover:bg-secondary/80 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <Volume2 size={16} />
              批量配音
              <span className="text-muted-foreground ml-1 text-xs">
                {project.scenes.filter((s) => s.audioUrl).length}/
                {project.scenes.filter((s) => s.dialogue || s.narration).length}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 单分镜视频查看弹窗 */}
      <SceneVideoDialog
        open={!!viewingVideoScene}
        videoUrl={viewingVideoScene?.videoUrl ?? null}
        title={`分镜 #${(viewingVideoScene?.order ?? 0) + 1} 视频`}
        aspectRatio={project.aspectRatio}
        onClose={() => setViewingVideoScene(null)}
      />
    </div>
  );
}

// memo：分镜列表含 20+ 卡片，避免编辑器顶层弹窗 state 变化时整列表重渲染。
export const SceneList = memo(SceneListImpl);
