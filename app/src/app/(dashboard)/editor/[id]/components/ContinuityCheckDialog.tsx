"use client";

/**
 * AI 场记（视觉连贯性体检）弹窗（计划 §5 · 2.3）
 *
 * 点「开始体检」→ POST continuity-check（建任务）→ 轮询直至终态 →
 * 展示综合评级（A/B/C/D 徽章）+ 一句话总结 + 逐条问题清单（按后镜分组）。
 * 每条问题带「按建议重生成」→ 走已有的 iterate+note 迭代生成机制
 * （onIterateScene，与编辑器「基于此图迭代」同一 mutation），触发后禁用该行按钮显示「已提交」。
 *
 * 降级不阻断：视觉能力不可用 / <2 出图时，POST 直接返回 400，弹窗原样展示后端中文错误。
 */

import { useState } from "react";
import {
  Loader2,
  Stethoscope,
  AlertTriangle,
  CheckCircle2,
  Wand2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  runContinuityCheck,
  type ContinuityReport,
  type ContinuityReportIssue,
  type ContinuityGrade,
} from "@/lib/assist-client";
import type { Scene } from "@/types";

interface ContinuityCheckDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** 分镜列表（用来把 sceneId 映射回 Scene 对象，喂给迭代重生成） */
  scenes: Scene[];
  /** 按建议重生成：走编辑器同一 iterate+note 迭代生成 mutation */
  onIterateScene: (sceneId: string, scene: Scene, note: string) => void;
}

/** 等级徽章配色（A 绿 / B 蓝 / C 橙 / D 红） */
const GRADE_STYLES: Record<ContinuityGrade, string> = {
  A: "bg-green-500/15 text-green-600 border-green-500/40",
  B: "bg-blue-500/15 text-blue-600 border-blue-500/40",
  C: "bg-amber-500/15 text-amber-600 border-amber-500/40",
  D: "bg-red-500/15 text-red-600 border-red-500/40",
};

/** 严重度 chip 配色 */
const SEVERITY_STYLES: Record<ContinuityReportIssue["severity"], string> = {
  严重: "bg-red-500/15 text-red-600",
  中等: "bg-amber-500/15 text-amber-600",
  轻微: "bg-secondary text-muted-foreground",
};

export function ContinuityCheckDialog({
  open,
  onClose,
  projectId,
  scenes,
  onIterateScene,
}: ContinuityCheckDialogProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ContinuityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 已提交重生成的问题行（key = sceneId + index），禁用按钮 + 显示「已提交」
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());

  const sceneById = new Map(scenes.map((s) => [s.id, s]));

  const reset = () => {
    setReport(null);
    setError(null);
    setSubmitted(new Set());
  };

  const handleStart = async () => {
    setLoading(true);
    setReport(null);
    setError(null);
    setSubmitted(new Set());
    try {
      const result = await runContinuityCheck(projectId);
      setReport(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "连贯性体检失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = (issue: ContinuityReportIssue, rowKey: string) => {
    const scene = sceneById.get(issue.sceneId);
    if (!scene) {
      toast.error("该分镜已不存在，无法重生成");
      return;
    }
    if (!scene.imageUrl) {
      toast.error("该分镜尚无图片，无法基于原图迭代");
      return;
    }
    onIterateScene(issue.sceneId, scene, issue.fixNote);
    setSubmitted((prev) => new Set(prev).add(rowKey));
    toast.success(`已提交重生成：镜 ${issue.sceneOrder}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope size={18} className="text-primary" />
            AI 场记 · 连贯性体检
          </DialogTitle>
          <DialogDescription>
            AI 逐对比对相邻分镜图片，检查角色服装 / 发型 / 环境 / 光线 /
            色调是否跳变（使用视觉大模型，免费）。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] min-h-24 overflow-y-auto">
          {loading ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-sm">
              <Loader2 size={20} className="animate-spin" />
              AI 正在逐对审片，镜头较多时需要一会儿…
            </div>
          ) : error ? (
            <div className="text-destructive flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-3 text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : report ? (
            <div className="space-y-3">
              {/* 评级 + 总结（grade 为 null = 体检未完成，展示中性告警徽章，绝不绿 A） */}
              <div className="flex items-center gap-3">
                {report.grade ? (
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xl font-bold ${GRADE_STYLES[report.grade]}`}
                  >
                    {report.grade}
                  </span>
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-600">
                    <AlertTriangle size={20} />
                  </span>
                )}
                <p className="text-foreground text-sm">{report.summary}</p>
              </div>

              {/* 体检未完成（无一对成功检查）：不展示问题清单，只保留上方告警总结 */}
              {report.grade === null ? null : report.issues.length > 0 ? (
                <ul className="space-y-2">
                  {report.issues.map((issue, idx) => {
                    const rowKey = `${issue.sceneId}-${idx}`;
                    const isSubmitted = submitted.has(rowKey);
                    return (
                      <li
                        key={rowKey}
                        className="bg-secondary/50 rounded-lg px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-foreground font-medium">
                            镜 {issue.sceneOrder}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-foreground">
                            {issue.dimension}
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] ${SEVERITY_STYLES[issue.severity]}`}
                          >
                            {issue.severity}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {issue.description}
                        </p>
                        <p className="text-muted-foreground/80 mt-0.5 text-xs">
                          建议：{issue.fixNote}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRegenerate(issue, rowKey)}
                          disabled={isSubmitted}
                          className="bg-primary/10 text-primary hover:bg-primary/20 mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {isSubmitted ? (
                            <>
                              <CheckCircle2 size={13} />
                              已提交
                            </>
                          ) : (
                            <>
                              <Wand2 size={13} />
                              按建议重生成
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
                  <CheckCircle2 size={16} className="text-green-600" />
                  未发现明显连贯性问题
                </div>
              )}
            </div>
          ) : (
            /* 初始态：说明 + 开始按钮 */
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-8 text-center text-sm">
              <Stethoscope size={28} className="text-primary/60" />
              <p>
                对项目内所有已出图的相邻分镜做一次连贯性体检，
                找出跨镜跳变并给出可一键修复的建议。
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={loading}
          >
            {report || error ? "关闭" : "取消"}
          </Button>
          <Button onClick={handleStart} disabled={loading}>
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Stethoscope size={14} />
            )}
            {report || error ? "重新体检" : "开始体检"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
