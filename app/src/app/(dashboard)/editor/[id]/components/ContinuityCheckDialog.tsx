"use client";

/**
 * AI 场记（视觉连贯性体检）弹窗（计划 §5 · 2.3）
 *
 * 点「开始体检」→ POST continuity-check（建任务）→ 轮询直至终态 →
 * 展示综合评级（A/B/C/D 徽章）+ 一句话总结 + 问题清单（按后镜分组为卡片）。
 * 每镜一个「按建议重生成」：同镜多条建议【合并为一次】迭代生成（fixNote 去重
 * 分号拼接）——若按条各自重生成，多个并发任务写同一 Scene.imageUrl，
 * 只有最后完成的留下，其余全被覆盖白跑，修复互不叠加。
 * （onIterateScene 返回 mutation Promise，与编辑器「基于此图迭代」同一 mutation）。
 * 卡片状态机跟踪单次提交结果：生成中… → 已重生成 / 生成失败（可重试）。
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
  RefreshCw,
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
  /**
   * 按建议重生成：走编辑器同一 iterate+note 迭代生成 mutation。
   * 必须回传 mutation Promise（mutateAsync），弹窗据此逐行展示成功/失败终态。
   * 第 4 参为前镜当前图（一致性锚），provider 支持多参考图时注入。
   */
  onIterateScene: (
    sceneId: string,
    scene: Scene,
    note: string,
    anchorImageUrl?: string
  ) => Promise<unknown>;
}

/** 单条问题行的重生成状态：未提交（无记录）→ 生成中 → 成功 / 失败（可重试） */
type RegenPhase = "processing" | "success" | "failed";

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

/**
 * 按后镜分组问题清单（保持报告原有顺序）：同镜多条问题合并为一张卡片、
 * 一次重生成。返回 [sceneId, 该镜全部问题][]，同镜问题共享 prevSceneId/sceneOrder。
 */
function groupIssuesByScene(
  issues: ContinuityReportIssue[]
): Array<[string, ContinuityReportIssue[]]> {
  const groups = new Map<string, ContinuityReportIssue[]>();
  for (const issue of issues) {
    groups.set(issue.sceneId, [...(groups.get(issue.sceneId) ?? []), issue]);
  }
  return [...groups.entries()];
}

/**
 * 合并同镜多条修复建议为一条迭代指令：去重后以分号拼接，
 * 一次生成同时覆盖服装/发型/光线/色调等全部问题（互不覆盖）。
 */
function mergeFixNotes(issues: ContinuityReportIssue[]): string {
  const notes = issues.map((i) => i.fixNote.trim()).filter((n) => n.length > 0);
  return [...new Set(notes)].join("；");
}

/**
 * 解析一致性锚图：优先报告里的 prevSceneId；老报告缺字段时按 order 回退
 * 找目标镜之前最近一张已出图的分镜（与 buildPairList 的配对规则一致）。
 * 找不到返回 undefined —— 行为退化为原单图迭代，不阻断修复。
 */
function resolveAnchorImageUrl(
  issue: ContinuityReportIssue,
  scenes: Scene[]
): string | undefined {
  // 优先走报告里的前镜 id（连贯性基准）
  if (issue.prevSceneId) {
    const prev = scenes.find((s) => s.id === issue.prevSceneId);
    return prev?.imageUrl ?? undefined;
  }
  // 老报告缺 prevSceneId：按 order 升序取已出图分镜中，目标镜前一张
  const ordered = [...scenes]
    .filter((s) => Boolean(s.imageUrl))
    .sort((a, b) => a.order - b.order);
  const targetIdx = ordered.findIndex((s) => s.id === issue.sceneId);
  if (targetIdx <= 0) return undefined;
  return ordered[targetIdx - 1]?.imageUrl ?? undefined;
}

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
  // 每镜卡片的重生成状态（key = sceneId，同镜合并为一次生成），无记录 = 未提交
  const [scenePhases, setScenePhases] = useState<Map<string, RegenPhase>>(
    new Map()
  );

  const sceneById = new Map(scenes.map((s) => [s.id, s]));

  const setScenePhase = (sceneId: string, phase: RegenPhase) => {
    setScenePhases((prev) => new Map(prev).set(sceneId, phase));
  };

  const reset = () => {
    setReport(null);
    setError(null);
    setScenePhases(new Map());
  };

  const handleStart = async () => {
    setLoading(true);
    setReport(null);
    setError(null);
    setScenePhases(new Map());
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

  const handleRegenerate = (
    sceneId: string,
    issues: ContinuityReportIssue[]
  ) => {
    const scene = sceneById.get(sceneId);
    if (!scene) {
      toast.error("该分镜已不存在，无法重生成");
      return;
    }
    if (!scene.imageUrl) {
      toast.error("该分镜尚无图片，无法基于原图迭代");
      return;
    }
    const sceneOrder = issues[0]?.sceneOrder;
    setScenePhase(sceneId, "processing");
    // 一致性锚 = 前镜当前图（若前镜后来也被重生成，用的即是新版，链式对齐）；
    // 同镜问题出自同一相邻对，取首条的 prevSceneId 即可
    const anchorUrl = resolveAnchorImageUrl(issues[0], scenes);
    onIterateScene(sceneId, scene, mergeFixNotes(issues), anchorUrl)
      .then(() => {
        setScenePhase(sceneId, "success");
        toast.success(`镜 ${sceneOrder} 已按建议重生成`);
      })
      .catch(() => {
        // 失败原因由 mutation 全局 onError 弹 toast（含去充值/去配置出口），
        // 这里只把卡片状态置为失败并放开按钮允许重试
        setScenePhase(sceneId, "failed");
      });
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
                  {groupIssuesByScene(report.issues).map(
                    ([sceneId, issues]) => {
                      const phase = scenePhases.get(sceneId);
                      return (
                        <li
                          key={sceneId}
                          className="bg-secondary/50 rounded-lg px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-foreground font-medium">
                              镜 {issues[0]?.sceneOrder}
                            </span>
                            {issues.length > 1 && (
                              <span className="text-muted-foreground text-xs">
                                {issues.length} 处问题
                              </span>
                            )}
                          </div>
                          <ul className="mt-1 space-y-1.5">
                            {issues.map((issue, idx) => (
                              <li key={`${sceneId}-${idx}`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-foreground text-xs font-medium">
                                    {issue.dimension}
                                  </span>
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${SEVERITY_STYLES[issue.severity]}`}
                                  >
                                    {issue.severity}
                                  </span>
                                </div>
                                <p className="text-muted-foreground mt-0.5 text-xs">
                                  {issue.description}
                                </p>
                                <p className="text-muted-foreground/80 mt-0.5 text-xs">
                                  建议：{issue.fixNote}
                                </p>
                              </li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            onClick={() => handleRegenerate(sceneId, issues)}
                            disabled={
                              phase === "processing" || phase === "success"
                            }
                            className={`mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              phase === "success"
                                ? "bg-green-500/10 text-green-600"
                                : phase === "failed"
                                  ? "bg-red-500/10 text-red-600 hover:bg-red-500/20"
                                  : "bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-70"
                            }`}
                          >
                            {phase === "processing" ? (
                              <>
                                <Loader2 size={13} className="animate-spin" />
                                生成中…
                              </>
                            ) : phase === "success" ? (
                              <>
                                <CheckCircle2 size={13} />
                                已重生成
                              </>
                            ) : phase === "failed" ? (
                              <>
                                <RefreshCw size={13} />
                                生成失败 · 重试
                              </>
                            ) : (
                              <>
                                <Wand2 size={13} />
                                {issues.length > 1
                                  ? `按建议重生成（合并 ${issues.length} 条）`
                                  : "按建议重生成"}
                              </>
                            )}
                          </button>
                        </li>
                      );
                    }
                  )}
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
