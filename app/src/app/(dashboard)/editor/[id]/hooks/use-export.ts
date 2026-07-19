"use client";

import { useState, useEffect, useRef } from "react";
import type { SubtitleStyle, Watermark } from "@/types/export-style";
import type { ColorGrade } from "@/lib/color-grade";

interface ExportStatus {
  isExporting: boolean;
  taskId: string | null;
  progress: number;
  error: string | null;
  videoUrl: string | null;
}

interface ExportOptions {
  format: string;
  quality: string;
  includeSubtitles: boolean;
  includeAudio: boolean;
  subtitleStyle?: SubtitleStyle;
  watermark?: Watermark;
  /** 全片 LUT 调色（批6，body 覆盖 generationParams.colorGrade） */
  colorGrade?: ColorGrade;
  /** 片头标题卡开关（批6，body 覆盖 generationParams.titleCards.title） */
  titleCard?: boolean;
  /** 片尾钩子卡开关（批6，body 覆盖 generationParams.titleCards.end） */
  endCard?: boolean;
}

const INITIAL_STATUS: ExportStatus = {
  isExporting: false,
  taskId: null,
  progress: 0,
  error: null,
  videoUrl: null,
};

/**
 * 导出视频的状态机 + 进度轮询。行为与原页面完全一致：
 * - handleExport：POST 触发导出；completed 直接回填 videoUrl，否则进入轮询
 * - pollExportProgress：2s/次 × 150 = 5 分钟上限；completed/failed/超时三路出口
 * - stopExportPoll：清理定时器，卸载时自动调用避免僵尸轮询
 */
export function useExport(projectId: string) {
  const [exportStatus, setExportStatus] = useState<ExportStatus>({
    ...INITIAL_STATUS,
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
  const handleExport = async (options: ExportOptions) => {
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
        // 不再自动 window.open：调用点在 await 之后已脱离用户手势调用栈，
        // 弹窗拦截器几乎必拦，用户只会看到地址栏拦截图标却以为"已打开"。
        // 下载入口收敛到导出弹窗内的显式「下载视频」按钮。
        setExportStatus({
          isExporting: false,
          taskId: null,
          progress: 100,
          error: null,
          videoUrl,
        });
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
          // 同上：异步轮询回调里的 window.open 必被拦截，靠弹窗下载按钮兜底
          setExportStatus({
            isExporting: false,
            taskId: null,
            progress: 100,
            error: null,
            videoUrl: data.videoUrl || null,
          });
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

  const resetExport = () => {
    stopExportPoll();
    setExportStatus({
      isExporting: false,
      taskId: null,
      progress: 0,
      error: null,
      videoUrl: null,
    });
  };

  return { exportStatus, handleExport, resetExport, stopExportPoll };
}
