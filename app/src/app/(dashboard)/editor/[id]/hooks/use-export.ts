"use client";

import { useState, useEffect, useRef } from "react";
import type { SubtitleStyle, Watermark } from "@/types/export-style";
import type { ColorGrade } from "@/lib/color-grade";
import type { AiDisclosure } from "@/lib/ai-disclosure";
import { classifyPollFailure } from "@/lib/generation-task-client";
import { hasExportPollTimedOut } from "@/lib/export-progress";

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
  /**
   * AI 生成内容提示标识（合规，广电总局令第 16 号第三十四条）。
   * body 覆盖 generationParams.aiDisclosure；缺省由导出端按「缺省即启用」解析。
   */
  aiDisclosure?: AiDisclosure;
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
 * - pollExportProgress：每 2s 查询，最多等待 30 分钟；等待超限仍保留原任务以便续查
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
    const startedAt = Date.now();
    // 连续请求失败计数：与生成任务轮询共用 classifyPollFailure 策略。
    // 此前任一次 fetch 抛错就停轮并报「获取进度失败」，而后端仍在导出，
    // 用户以为失败会再点一次导出 → 二次扣费。
    let consecutiveFailures = 0;
    // 网络失败也按真实经过时间计入等待窗口，避免浏览器节流造成计次偏差。
    const scheduleNext = () => {
      if (hasExportPollTimedOut(startedAt)) {
        abortWith("等待导出结果时间较长，任务可能仍在后台执行，请查看任务状态");
        return;
      }
      exportPollRef.current = setTimeout(poll, 2000);
    };
    const abortWith = (message: string) => {
      stopExportPoll();
      setExportStatus((prev) => ({
        ...prev,
        isExporting: false,
        taskId,
        error: message,
        videoUrl: null,
      }));
    };
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/export?taskId=${taskId}`
        );
        if (!res.ok) {
          const verdict = classifyPollFailure(
            ++consecutiveFailures,
            res.status
          );
          if (verdict.action === "continue") {
            scheduleNext();
            return;
          }
          // 4xx（鉴权失败 / 任务不存在）无重试价值：取服务端文案，缺省兜底
          const data = await res.json().catch(() => null);
          abortWith(verdict.message || data?.error || "获取进度失败");
          return;
        }
        consecutiveFailures = 0;
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
        } else {
          setExportStatus((prev) => ({
            ...prev,
            progress: data.progress || 0,
          }));
          scheduleNext();
        }
      } catch {
        // 网络异常（fetch 抛错）：容忍连续若干次，后端导出仍在跑
        const verdict = classifyPollFailure(++consecutiveFailures);
        if (verdict.action === "continue") {
          scheduleNext();
          return;
        }
        abortWith(verdict.message || "获取进度失败");
      }
    };
    poll();
  };

  const resetExport = () => {
    stopExportPoll();
    // 等待/网络问题不能证明后台失败；保留 taskId 后只续查，避免重复提交导出。
    if (exportStatus.taskId) {
      setExportStatus((prev) => ({ ...prev, isExporting: true, error: null }));
      void pollExportProgress(exportStatus.taskId);
      return;
    }
    setExportStatus({
      isExporting: false,
      taskId: null,
      progress: 0,
      error: null,
      videoUrl: null,
    });
  };

  const recoverExport = async () => {
    stopExportPoll();
    setExportStatus((prev) => ({ ...prev, isExporting: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${projectId}/export?latest=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取导出结果失败");
      if (data.status === "completed") {
        setExportStatus({
          ...INITIAL_STATUS,
          progress: 100,
          videoUrl: data.videoUrl || null,
        });
      } else if (data.status === "failed") {
        setExportStatus({ ...INITIAL_STATUS, error: data.error || "导出失败" });
      } else {
        setExportStatus({
          ...INITIAL_STATUS,
          isExporting: true,
          taskId: data.taskId,
          progress: data.progress || 0,
        });
        void pollExportProgress(data.taskId);
      }
    } catch (err) {
      setExportStatus({
        ...INITIAL_STATUS,
        error: err instanceof Error ? err.message : "获取导出结果失败",
      });
    }
  };

  return {
    exportStatus,
    handleExport,
    resetExport,
    stopExportPoll,
    recoverExport,
  };
}
