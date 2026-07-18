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
}

type MediaKind = "image" | "video" | "audio";

/**
 * 中栏底部批量区：三个等宽 split-button（批量图片/视频/配音）压成单行。
 *
 * 每个 split-button = 主区（icon + 标签 + 完成计数 + 底部进度条）+ 右侧 ChevronDown
 * 小按钮（打开该媒体类型的模型配置浮层）。计数口径与 targets 过滤逻辑与原底部三行
 * 逐字保留；底部图片批量**不走** onBeforeBatchImages 关口（保持原语义，仅顶部
 * 「批量生成」走关口）。
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
}: BatchActionsBarProps) {
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

  // 三类计数口径（与原底部三行逐字一致）
  const imageDone = scenes.filter((s) => s.imageUrl).length;
  const imageTotal = scenes.length;
  const videoDone = scenes.filter((s) => s.videoUrl).length;
  const videoTotal = scenes.length;
  const audioDone = scenes.filter((s) => s.audioUrl).length;
  const audioTotal = scenes.filter((s) => s.dialogue || s.narration).length;

  // 各类点击行为（targets 过滤逻辑逐字迁移自原底部三行）
  const handleBatchImages = () => {
    const targets = scenes.filter(
      (s) => !s.imageUrl && s.imageStatus !== "PROCESSING"
    );
    if (targets.length === 0 || !batchGenerateImagesMutation) return;
    batchGenerateImagesMutation.mutate({
      scenes: targets,
      imageConfigId: mediaConfig.image.selected,
    });
  };
  const handleBatchVideos = () => {
    const targets = scenes.filter(
      (s) => s.imageUrl && !s.videoUrl && s.videoStatus !== "PROCESSING"
    );
    if (targets.length === 0 || !batchGenerateVideosMutation) return;
    batchGenerateVideosMutation.mutate({
      scenes: targets,
      videoConfigId: mediaConfig.video.selected,
    });
  };
  const handleBatchAudios = () => {
    const targets = scenes.filter(
      (s) =>
        (s.dialogue || s.narration) &&
        !s.audioUrl &&
        s.audioStatus !== "PROCESSING"
    );
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
    onClick: () => void;
    config: MediaConfigControls["image"];
  }> = [
    {
      kind: "image",
      category: "IMAGE",
      label: "批量图片",
      Icon: ImageIcon,
      done: imageDone,
      total: imageTotal,
      onClick: handleBatchImages,
      config: mediaConfig.image,
    },
    {
      kind: "video",
      category: "VIDEO",
      label: "批量视频",
      Icon: Video,
      done: videoDone,
      total: videoTotal,
      onClick: handleBatchVideos,
      config: mediaConfig.video,
    },
    {
      kind: "audio",
      category: "TTS",
      label: "批量配音",
      Icon: Volume2,
      done: audioDone,
      total: audioTotal,
      onClick: handleBatchAudios,
      config: mediaConfig.audio,
    },
  ];

  return (
    <div className="border-border space-y-2 border-t p-4" ref={configRef}>
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
          ({ kind, category, label, Icon, done, total, onClick, config }) => {
            // 完成度进度条比例（total 为 0 时不填充，避免 NaN）
            const ratio = total > 0 ? Math.min(1, done / total) : 0;
            return (
              <div key={kind} className="relative flex flex-1">
                <div className="bg-secondary flex flex-1 overflow-hidden rounded-lg">
                  {/* 主区：icon + 标签 + 计数 + 底部进度条 */}
                  <button
                    onClick={onClick}
                    disabled={anyBatchPending}
                    className="hover:bg-secondary/80 relative flex flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-sm disabled:opacity-50"
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon size={14} />
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
                  <div className="bg-card border-border absolute bottom-full left-0 z-50 mb-2 w-56 rounded-lg border p-3 shadow-xl">
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
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
