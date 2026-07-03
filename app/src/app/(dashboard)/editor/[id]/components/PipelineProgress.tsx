"use client";

import { Check } from "lucide-react";
import type { ProjectDetail } from "@/types";

/**
 * 7 步管线进度总览条（紧贴编辑器头部下方）。
 *
 * 此前页面没有任何「当前进行到哪一步 / 离能导出差多少」的全局指示，
 * 进度只能靠底部三个分散的 n/N 徽章分别看（ux-editor P1-8）。
 * 这里给一条轻量横向指示：分镜 → 图片 → 视频 → 配音 → 导出就绪。
 */
export function PipelineProgress({ project }: { project: ProjectDetail }) {
  const total = project.scenes.length;
  if (total === 0) return null;

  const images = project.scenes.filter((s) => s.imageUrl).length;
  const videos = project.scenes.filter((s) => s.videoUrl).length;
  // 配音只统计有台词/旁白的分镜（无文本的分镜本就不需要配音）
  const speakable = project.scenes.filter(
    (s) => s.dialogue || s.narration
  ).length;
  const audios = project.scenes.filter((s) => s.audioUrl).length;

  const steps: Array<{ label: string; done: number; total: number }> = [
    { label: "分镜", done: total, total },
    { label: "图片", done: images, total },
    { label: "视频", done: videos, total },
    { label: "配音", done: audios, total: speakable },
  ];

  return (
    <div className="border-border bg-card/30 text-muted-foreground flex shrink-0 items-center gap-1 overflow-x-auto border-b px-4 py-1.5 text-xs whitespace-nowrap">
      {steps.map((step, i) => {
        const complete = step.total > 0 && step.done >= step.total;
        const skipped = step.total === 0;
        return (
          <span key={step.label} className="flex items-center gap-1">
            {i > 0 && <span className="text-border mx-1">›</span>}
            <span
              className={
                complete
                  ? "text-primary flex items-center gap-0.5"
                  : step.done > 0
                    ? "text-foreground"
                    : ""
              }
            >
              {complete && <Check size={12} />}
              {step.label}
              {skipped ? "（无需）" : ` ${step.done}/${step.total}`}
            </span>
          </span>
        );
      })}
      <span className="text-border mx-1">›</span>
      <span className={images > 0 ? "text-primary" : ""}>
        {images > 0 ? "可导出" : "生成图片后可导出"}
      </span>
    </div>
  );
}
