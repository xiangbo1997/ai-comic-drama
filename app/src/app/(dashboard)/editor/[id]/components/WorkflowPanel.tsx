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

/** 闭环评审步骤 → 人类可读标签（C6：质量评审小节用） */
const REVIEW_STEP_LABELS: Record<string, string> = {
  review_character_bible: "角色圣经",
  review_storyboard: "分镜连贯",
  review_videos: "视频连贯",
};

/** 从 SSE 事件里解析出的质量评审结果（C6） */
interface ReviewSummary {
  step: string;
  label: string;
  score?: number;
  pass?: boolean;
  suggestions: string[];
}

/**
 * 从事件流里抽取闭环评审结果（C6）。
 *
 * 评审结果同时持久化到 WorkflowRun.artifacts（服务端），并通过 review_* 步骤的
 * step:completed 事件实时下发。这里读事件流做展示——同一步骤多次出现时取最后一条
 * （闭环可能多轮）。评审默认关闭，未开启时无这些事件，返回空数组自然隐藏该小节。
 */
function extractReviews(events: WorkflowEvent[]): ReviewSummary[] {
  const byStep = new Map<string, ReviewSummary>();
  for (const evt of events) {
    const step = evt.step;
    if (!step || !(step in REVIEW_STEP_LABELS)) continue;
    if (evt.type !== "step:completed") continue;
    const data = evt.data as {
      score?: number;
      pass?: boolean;
      passed?: boolean;
      suggestions?: string[];
    };
    byStep.set(step, {
      step,
      label: REVIEW_STEP_LABELS[step],
      score: typeof data.score === "number" ? data.score : undefined,
      // 角色圣经评审用 passed，分镜/视频评审用 pass —— 兼容两种键名
      pass: data.pass ?? data.passed,
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    });
  }
  return Array.from(byStep.values());
}

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

  // C6：从事件流抽取闭环评审结果；评审默认关闭时为空数组，该小节自然隐藏
  const reviews = extractReviews(events);
  // 完成态：引导用户使用已有的 AI 场记 / 审片报告入口
  const isCompleted = status?.status === "COMPLETED";

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

          {/* 质量评审小节（C6）：闭环评审开启时展示分数 + 建议，样式对齐面板风格 */}
          {reviews.length > 0 && (
            <div className="border-border/60 space-y-1 rounded-md border p-2">
              <p className="text-muted-foreground text-xs font-medium">
                质量评审
              </p>
              {reviews.map((r) => (
                <div key={r.step} className="space-y-0.5">
                  <div className="flex items-center gap-2 text-xs">
                    {r.pass === true ? (
                      <CheckCircle2 size={12} className="text-green-400" />
                    ) : r.pass === false ? (
                      <XCircle size={12} className="text-amber-400" />
                    ) : null}
                    <span className="text-foreground">{r.label}</span>
                    {typeof r.score === "number" && (
                      <span className="text-muted-foreground">
                        {r.score} 分
                      </span>
                    )}
                  </div>
                  {r.suggestions.length > 0 && (
                    <ul className="text-muted-foreground ml-5 list-disc space-y-0.5 text-xs">
                      {r.suggestions.slice(0, 3).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
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

          {/* 完成态引导（C6）：提示用户可用已有的 AI 场记 / 审片报告入口做深度质检。
              刻意不自动触发这两项——它们各自会消耗积分（LLM/视觉调用），是否运行由
              用户决定，避免一键 workflow 完成后擅自烧额度。 */}
          {isCompleted && (
            <p className="text-muted-foreground text-xs">
              管线已完成。可在工具栏使用「AI
              场记」核对分镜连续性，或用「审片报告」做整体质检（按需触发，不自动执行）。
            </p>
          )}

          {/* 错误信息 */}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
