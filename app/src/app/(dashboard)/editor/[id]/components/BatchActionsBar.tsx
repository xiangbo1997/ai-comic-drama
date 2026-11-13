"use client";

import { useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon,
  Video,
  Volume2,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { ModelSelector } from "@/components/ai-models";
import { summarizeRenderPlan } from "@/lib/render-mode";
import { getMediaBatchState } from "@/lib/editor-readiness";
import { useToast } from "@/components/ui/toast";
import type { BatchProgress } from "../hooks/use-generation-actions";
import type { MediaConfigControls } from "./SceneList";
import type { Scene } from "@/types";
import type { UseMutationResult } from "@tanstack/react-query";

interface BatchActionsBarProps {
  scenes: Scene[];
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
  /** 任一批量在跑时禁用全部批量入口 */
  anyBatchPending: boolean;
  /** 图/视/音三类媒体配置控制 */
  mediaConfig: MediaConfigControls;
  /**
   * 批量出图前的定妆锚关口（包 B · B3）：返回 Promise<false> 表示中止本次批量。
   * 缺省时视为放行。
   */
  onBeforeBatchImages?: () => Promise<boolean>;
}

type MediaKind = "image" | "video" | "audio";

/**
 * 中栏底部批量区：三个等宽 split-button（批量图片/视频/配音）压成单行。
 *
 * 每个 split-button = 主区（icon + 标签 + 完成计数 + 底部进度条）+ 右侧 ChevronDown
 * 小按钮（打开该媒体类型的模型配置浮层）。计数与可生成目标统一由
 * getMediaBatchState 派生，无目标时禁用，保留已生成内容。
 *
 * 「批量图片」现在与顶部「批量生成」一样走 onBeforeBatchImages 定妆锚关口
 * （包 B · B3）：此前刻意不走，结果这里成了唯一绕过关口的出图入口——而制片人
 * 审阅完成后的引导恰好把新手指向这个按钮，必然得到一整批不一致的图。
 */
export function BatchActionsBar({
  scenes,
  batchGenerateImagesMutation,
  batchGenerateVideosMutation,
  batchGenerateAudiosMutation,
  batchProgress,
  onCancelBatch,
  anyBatchPending,
  mediaConfig,
  onBeforeBatchImages,
}: BatchActionsBarProps) {
  const toast = useToast();
  // 同一时刻最多打开一个模型配置浮层
  const [openConfigFor, setOpenConfigFor] = useState<MediaKind | null>(null);
  const configRef = useRef<HTMLDivElement>(null);

  // 点击浮层外部关闭（模式照抄 model-selector.tsx）
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        configRef.current &&
        !configRef.current.contains(event.target as Node)
      ) {
        setOpenConfigFor(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const image = getMediaBatchState(scenes, "image");
  const video = getMediaBatchState(scenes, "video");
  const audio = getMediaBatchState(scenes, "audio");

  // 批量只补缺失内容；单镜重生成仍在分镜编辑入口操作。
  const handleBatchImages = async () => {
    const targets = image.targets;
    if (targets.length === 0 || !batchGenerateImagesMutation) return;
    // 定妆锚关口（包 B · B3 路径 3/4）：缺锚时先补定妆照再批量出图
    if (onBeforeBatchImages && !(await onBeforeBatchImages())) return;
    batchGenerateImagesMutation.mutate({
      scenes: targets,
      imageConfigId: mediaConfig.image.selected,
    });
  };
  const handleBatchVideos = () => {
    const targets = video.targets;
    if (targets.length === 0 || !batchGenerateVideosMutation) return;
    batchGenerateVideosMutation.mutate({
      scenes: targets,
      videoConfigId: mediaConfig.video.selected,
    });
  };

  /**
   * 智能混合（经济）：只对「值得花钱生成视频」的镜（高动态/冲击/高潮，见 lib/render-mode）
   * 生成视频，其余镜走图片运镜（零成本）。执行前展示摘要让用户确认。
   * 与「批量视频」共用同一 mutation，仅缩小目标集——省钱语义清晰、逻辑不重复。
   */
  const handleSmartHybridVideos = async () => {
    setOpenConfigFor(null);
    const candidates = video.targets;
    if (candidates.length === 0 || !batchGenerateVideosMutation) return;
    const plan = summarizeRenderPlan(candidates);
    if (plan.videoCount === 0) {
      toast.info(
        `按成本路由，当前 ${candidates.length} 个待生成镜均可用图片运镜承载，无需生成视频。`
      );
      return;
    }
    const videoIdSet = new Set(plan.videoSceneIds);
    const targets = candidates.filter((s) => videoIdSet.has(s.id));
    const confirmed = await toast.confirm(
      `智能混合（经济）：将为 ${plan.videoCount}/${candidates.length} 镜生成视频，` +
        `其余 ${plan.motionCount} 镜走图片运镜（零成本）。是否继续？`
    );
    if (!confirmed) return;
    batchGenerateVideosMutation.mutate({
      scenes: targets,
      videoConfigId: mediaConfig.video.selected,
    });
  };
  const handleBatchAudios = () => {
    const targets = audio.targets;
    if (targets.length === 0 || !batchGenerateAudiosMutation) return;
    batchGenerateAudiosMutation.mutate({
      scenes: targets,
      ttsConfigId: mediaConfig.audio.selected,
    });
  };

  // 单个 split-button 描述（含 category / 配置三元组 / 计数 / 点击）
  const buttons: Array<{
    kind: MediaKind;
    category: "IMAGE" | "VIDEO" | "TTS";
    label: string;
    Icon: typeof ImageIcon;
    done: number;
    total: number;
    available: number;
    enabled: boolean;
    onClick: () => void;
    config: MediaConfigControls["image"];
  }> = [
    {
      kind: "image",
      category: "IMAGE",
      label: "批量图片",
      Icon: ImageIcon,
      done: image.done,
      total: image.total,
      available: image.targets.length,
      enabled: Boolean(batchGenerateImagesMutation),
      // 关口是异步的（可能弹补锚弹窗并等待补锚完成），这里 fire-and-forget：
      // 内部已用 toast 汇报成败，按钮无需等待返回值
      onClick: () => void handleBatchImages(),
      config: mediaConfig.image,
    },
    {
      kind: "video",
      category: "VIDEO",
      label: "批量视频",
      Icon: Video,
      done: video.done,
      total: video.total,
      available: video.targets.length,
      enabled: Boolean(batchGenerateVideosMutation),
      onClick: handleBatchVideos,
      config: mediaConfig.video,
    },
    {
      kind: "audio",
      category: "TTS",
      label: "批量配音",
      Icon: Volume2,
      done: audio.done,
      total: audio.total,
      available: audio.targets.length,
      enabled: Boolean(batchGenerateAudiosMutation),
      onClick: handleBatchAudios,
      config: mediaConfig.audio,
    },
  ];

  return (
    <div
      className="border-border @container min-w-0 space-y-2 border-t p-3 md:p-4"
      ref={configRef}
    >
      {/* 批量运行中的 slim 提示行（Loader2 + 进度 + 停止后续），逻辑原样迁移 */}
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

      {/* 三个等宽 split-button 单行 */}
      <div className="flex items-stretch gap-2">
        {buttons.map(
          ({
            kind,
            category,
            label,
            Icon,
            done,
            total,
            available,
            enabled,
            onClick,
            config,
          }) => {
            // 完成度进度条比例（total 为 0 时不填充，避免 NaN）
            const ratio = total > 0 ? Math.min(1, done / total) : 0;
            return (
              <div key={kind} className="relative flex min-w-0 flex-1">
                <div className="bg-secondary flex min-w-0 flex-1 overflow-hidden rounded-lg">
                  {/* 主区：icon + 标签 + 计数 + 底部进度条 */}
                  <button
                    onClick={onClick}
                    disabled={anyBatchPending || !enabled || available === 0}
                    title={
                      available > 0
                        ? `补齐 ${available} 个分镜，保留已生成内容`
                        : kind === "video" && done < total
                          ? "暂无可生成的视频：请先出图，或等待当前任务完成；图片也可直接成片"
                          : "暂无待生成内容，已完成或正在处理中"
                    }
                    className="hover:bg-secondary/80 relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-xs disabled:opacity-50 @min-[420px]:px-2 @min-[420px]:text-sm"
                  >
                    <span className="flex flex-col items-center gap-1 @min-[420px]:flex-row @min-[420px]:gap-1.5">
                      <Icon size={14} className="hidden @min-[420px]:block" />
                      <span className="whitespace-nowrap">{label}</span>
                      <span className="text-muted-foreground text-xs">
                        {done}/{total}
                      </span>
                    </span>
                    {/* 底部 2px 完成度进度条 */}
                    <span className="bg-secondary absolute inset-x-0 bottom-0 h-[2px]">
                      <span
                        className="bg-primary block h-full"
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </span>
                  </button>
                  {/* 右侧窄段：ChevronDown 打开模型配置浮层 */}
                  <button
                    onClick={() =>
                      setOpenConfigFor((prev) => (prev === kind ? null : kind))
                    }
                    disabled={anyBatchPending}
                    className="border-border hover:bg-secondary/80 flex items-center border-l px-1.5 disabled:opacity-50"
                    title="选择生成模型"
                  >
                    <ChevronDown
                      size={14}
                      className={`transition ${
                        openConfigFor === kind ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </div>

                {/* 模型配置浮层（向上弹） */}
                {openConfigFor === kind && (
                  <div
                    className={`bg-card border-border absolute bottom-full z-50 mb-2 w-56 rounded-lg border p-3 shadow-xl ${kind === "image" ? "left-0" : kind === "audio" ? "right-0" : "left-1/2 -translate-x-1/2"}`}
                  >
                    <p className="text-muted-foreground mb-2 text-xs">
                      生成模型
                    </p>
                    <ModelSelector
                      category={category}
                      value={config.selected}
                      onChange={config.onChange}
                      onOpenMultiSelect={config.onOpenMultiSelect}
                      showMultiSelectButton
                      size="sm"
                    />
                    {/* 视频专属：智能混合（经济）入口——只对值得花钱的镜生成视频，
                        其余走图片运镜（零成本）。默认「批量视频」仍为全部生成。 */}
                    {kind === "video" && (
                      <button
                        onClick={handleSmartHybridVideos}
                        disabled={
                          anyBatchPending ||
                          !batchGenerateVideosMutation ||
                          video.targets.length === 0
                        }
                        className="border-border hover:bg-secondary/80 mt-3 w-full rounded-md border px-2 py-1.5 text-xs disabled:opacity-50"
                        title="只对高动态、冲击和高潮镜生成视频，其余镜走图片运镜；确认前显示本次生成镜数"
                      >
                        智能混合（经济）
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>
      <p className="text-muted-foreground text-[11px]">
        批量仅补缺失内容；视频可选，图片也能运镜成片。
      </p>
    </div>
  );
}
