"use client";

import { useState, useEffect } from "react";
import { Grid3x3, Loader2, ImageIcon } from "lucide-react";
import { ModelSelector } from "@/components/ai-models";
import type { StoryboardCell, StoryboardTableArtifact } from "@/types";
import {
  useDramaScript,
  type ShortDramaScriptRecord,
} from "../hooks/use-drama-script";

interface StoryboardTablePanelProps {
  projectId: string;
  /** 当前操作的脚本（来自 DramaScriptPanel 的最新脚本） */
  script: ShortDramaScriptRecord;
}

/**
 * 九宫格分镜表面板（阶段2 + 阶段3）
 * - 生成/编辑 9 格分镜表（镜头/对白/特写/转场）
 * - 一键生成九宫格合成图
 */
export function StoryboardTablePanel({
  projectId,
  script,
}: StoryboardTablePanelProps) {
  const {
    generateStoryboardMutation,
    updateStoryboardMutation,
    generateGridImageMutation,
  } = useDramaScript(projectId);

  const remoteCells =
    (script.storyboard as StoryboardTableArtifact | null)?.cells ?? [];
  const [cells, setCells] = useState<StoryboardCell[]>(remoteCells);
  const [imageConfigId, setImageConfigId] = useState<string | undefined>();

  // 远端分镜表变化时同步本地（生成完成后）
  useEffect(() => {
    setCells(remoteCells);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script.id, script.version]);

  const hasCells = cells.length === 9;

  const updateCell = (index: number, patch: Partial<StoryboardCell>) => {
    setCells((prev) =>
      prev.map((c) => (c.index === index ? { ...c, ...patch } : c))
    );
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Grid3x3 size={16} className="text-blue-500" />
        <h3 className="text-sm font-semibold">九宫格分镜表</h3>
      </div>

      {/* 阶段2：生成分镜表 */}
      <button
        onClick={() => generateStoryboardMutation.mutate(script.id)}
        disabled={generateStoryboardMutation.isPending}
        className="disabled:bg-secondary flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm transition hover:bg-blue-700 disabled:cursor-not-allowed"
      >
        {generateStoryboardMutation.isPending ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Grid3x3 size={16} />
        )}
        {generateStoryboardMutation.isPending
          ? "生成中..."
          : hasCells
            ? "重新生成分镜表"
            : "生成九宫格分镜表"}
      </button>

      {generateStoryboardMutation.isError && (
        <p className="text-center text-xs text-red-400">
          {(generateStoryboardMutation.error as Error)?.message ?? "生成失败"}
        </p>
      )}

      {/* 9 格编辑 */}
      {hasCells && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {cells.map((cell) => (
              <div
                key={cell.index}
                className="border-border bg-card/50 space-y-1 rounded-lg border p-2"
              >
                <div className="text-muted-foreground text-[10px] font-medium">
                  {cell.index}. {cell.sceneTitle}
                </div>
                <input
                  value={cell.shot}
                  onChange={(e) =>
                    updateCell(cell.index, { shot: e.target.value })
                  }
                  placeholder="镜头"
                  className="bg-card w-full rounded px-1.5 py-1 text-[11px] focus:outline-none"
                />
                <input
                  value={cell.closeup}
                  onChange={(e) =>
                    updateCell(cell.index, { closeup: e.target.value })
                  }
                  placeholder="特写"
                  className="bg-card w-full rounded px-1.5 py-1 text-[11px] focus:outline-none"
                />
                <input
                  value={cell.transition}
                  onChange={(e) =>
                    updateCell(cell.index, { transition: e.target.value })
                  }
                  placeholder="转场"
                  className="bg-card w-full rounded px-1.5 py-1 text-[11px] focus:outline-none"
                />
              </div>
            ))}
          </div>

          <button
            onClick={() =>
              updateStoryboardMutation.mutate({ scriptId: script.id, cells })
            }
            disabled={updateStoryboardMutation.isPending}
            className="bg-secondary hover:bg-secondary/80 w-full rounded-lg px-3 py-1.5 text-xs transition"
          >
            {updateStoryboardMutation.isPending
              ? "保存中..."
              : "保存分镜表打磨"}
          </button>

          {/* 阶段3：一键九宫格图 */}
          <div className="border-border space-y-2 border-t pt-3">
            <ModelSelector
              category="IMAGE"
              value={imageConfigId}
              onChange={(configId) => setImageConfigId(configId)}
              size="sm"
            />
            <button
              onClick={() =>
                generateGridImageMutation.mutate({
                  scriptId: script.id,
                  imageConfigId,
                })
              }
              disabled={generateGridImageMutation.isPending}
              className="disabled:bg-secondary flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed"
            >
              {generateGridImageMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ImageIcon size={16} />
              )}
              {generateGridImageMutation.isPending
                ? "生成九宫格图中..."
                : "一键生成九宫格图（5 积分）"}
            </button>
            {generateGridImageMutation.isError && (
              <p className="text-center text-xs text-red-400">
                {(generateGridImageMutation.error as Error)?.message ??
                  "生成失败"}
              </p>
            )}
            {script.gridImageUrl && (
              <img
                src={script.gridImageUrl}
                alt="九宫格分镜图"
                className="border-border w-full rounded-lg border"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
