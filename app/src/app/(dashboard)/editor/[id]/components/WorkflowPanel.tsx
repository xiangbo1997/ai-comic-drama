"use client";

import {
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  StopCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import type { WorkflowStatus, WorkflowEvent } from "@/services/agents/types";

interface WorkflowPanelProps {
  status: WorkflowStatus | null;
  events: WorkflowEvent[];
  isRunning: boolean;
  error: string | null;
  onCancel: () => void;
}

const STEP_LABELS: Record<string, string> = {
  parse_script: "剧本解析",
  build_character_bible: "角色圣经",
  build_storyboard: "分镜补全",
  generate_images: "图像生成",
  review_images: "图像评审",
  generate_videos: "视频生成",
  synthesize_voice: "语音合成",
  export_project: "导出",
};

export function WorkflowPanel({
  status,
  events,
  isRunning,
  error,
  onCancel,
}: WorkflowPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!status && !isRunning && events.length === 0) {
    return null;
  }

  const latestMessage =
    events.length > 0
      ? (events[events.length - 1].data as { message?: string }).message
      : null;

  return (
    <div className="border-border bg-background/50 border-t">
      {/* 摘要栏 */}
      <div
        className="hover:bg-card/50 flex cursor-pointer items-center justify-between px-4 py-2"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 text-sm">
          {isRunning ? (
            <Loader2 size={16} className="text-primary animate-spin" />
          ) : status?.status === "COMPLETED" ? (
            <CheckCircle2 size={16} className="text-green-400" />
          ) : status?.status === "FAILED" ? (
            <XCircle size={16} className="text-red-400" />
          ) : (
            <Zap size={16} className="text-primary" />
          )}
          <span className="text-foreground">
            {isRunning
              ? `Agent 管线运行中 — ${status?.progress ?? 0}%`
              : status?.status === "COMPLETED"
                ? "Agent 管线已完成"
                : status?.status === "FAILED"
                  ? "Agent 管线失败"
                  : "Agent 管线"}
          </span>
          {latestMessage && isRunning && (
            <span className="text-muted-foreground ml-2 max-w-xs truncate">
              {latestMessage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="p-1 text-red-400 hover:text-red-300"
              title="取消"
            >
              <StopCircle size={16} />
            </button>
          )}
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="space-y-2 px-4 pb-3">
          {/* 进度条：补 progressbar 语义，SR 用户可获知 AI 长任务进度（a6 P1-6） */}
          {status && (
            <div
              role="progressbar"
              aria-valuenow={status.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Agent 生成进度"
              className="bg-card h-1.5 w-full rounded-full"
            >
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${status.progress}%` }}
              />
            </div>
          )}

          {/* 步骤列表 */}
          {status?.steps && status.steps.length > 0 && (
            <div className="space-y-1">
              {status.steps.map((step) => (
                <div
                  key={step.step}
                  className="flex items-center gap-2 text-xs"
                >
                  {step.status === "completed" ? (
                    <CheckCircle2 size={12} className="text-green-400" />
                  ) : step.status === "running" ? (
                    <Loader2 size={12} className="text-primary animate-spin" />
                  ) : step.status === "failed" ? (
                    <XCircle size={12} className="text-red-400" />
                  ) : (
                    <div className="border-border h-3 w-3 rounded-full border" />
                  )}
                  <span
                    className={
                      step.status === "running"
                        ? "text-primary/80"
                        : "text-muted-foreground"
                    }
                  >
                    {STEP_LABELS[step.step] ?? step.step}
                  </span>
                  {step.reasoning && step.status === "completed" && (
                    <span className="text-muted-foreground max-w-xs truncate">
                      {step.reasoning}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 实时事件日志 */}
          {events.length > 0 && (
            <div className="text-muted-foreground max-h-32 space-y-0.5 overflow-y-auto font-mono text-xs">
              {events.slice(-10).map((evt, i) => (
                <div key={i}>
                  <span className="text-muted-foreground">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  <span className="text-muted-foreground">[{evt.type}]</span>{" "}
                  {(evt.data as { message?: string }).message ?? ""}
                </div>
              ))}
            </div>
          )}

          {/* 错误信息 */}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
