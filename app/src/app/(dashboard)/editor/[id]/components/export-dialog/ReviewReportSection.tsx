"use client";

import { useState } from "react";
import { Loader2, ChevronDown, ClipboardCheck, MapPin } from "lucide-react";
import type {
  ReviewReport,
  ReviewSection,
  ReviewSectionStatus,
} from "@/lib/review-report";

/** 综合等级徽章配色（A/B 绿、C 黄、D 红） */
const GRADE_BADGE: Record<string, string> = {
  A: "bg-green-500/15 text-green-500 border-green-500/30",
  B: "bg-green-500/15 text-green-500 border-green-500/30",
  C: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
  D: "bg-red-500/15 text-red-500 border-red-500/30",
};

/** 节状态圆点配色 */
const STATUS_DOT: Record<ReviewSectionStatus, string> = {
  ok: "bg-green-500",
  warn: "bg-yellow-500",
  bad: "bg-red-500",
};

/**
 * 审片报告分节（导出前体检）：点「生成审片报告」→ 同步 GET →
 * 渲染等级徽章 + 四节 + 建议清单；建议条目带「定位」跳转到对应分镜。
 * 报告纯确定性（无 LLM、不扣积分），可反复生成。
 */
export function ReviewReportSection({
  projectId,
  onJumpToScene,
  onClose,
}: {
  projectId: string;
  onJumpToScene: (sceneId: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReviewReport | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/review-report`);
      const data = (await res.json()) as {
        report?: ReviewReport;
        error?: string;
      };
      if (!res.ok || !data.report) {
        throw new Error(data.error || "生成审片报告失败");
      }
      setReport(data.report);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成审片报告失败");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleJump = (sceneId: string) => {
    onJumpToScene(sceneId);
    onClose();
  };

  return (
    <div className="border-border rounded-lg border">
      {/* 节标题 + 生成按钮 */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <ClipboardCheck size={16} className="text-primary" />
          <span>审片报告</span>
          {report && (
            <span
              className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${
                GRADE_BADGE[report.grade] ?? GRADE_BADGE.C
              }`}
            >
              {report.grade}
            </span>
          )}
          <ChevronDown
            size={16}
            className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="bg-secondary hover:bg-secondary/80 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
        >
          {loading && <Loader2 size={13} className="animate-spin" />}
          {report ? "重新体检" : "生成审片报告"}
        </button>
      </div>

      {/* 报告内容 */}
      {open && (
        <div className="border-border space-y-3 border-t px-4 pt-3 pb-4">
          {error && <p className="text-sm text-red-400">{error}</p>}

          {!error && !report && (
            <p className="text-muted-foreground text-sm">
              点右上角「生成审片报告」，导出前做一次体检（时长节奏 / 结尾钩子 /
              连贯性 / 素材完整性 / 红果红线 / 合规 / 叙事质量）。
            </p>
          )}

          {report && (
            <>
              {/* 各节（节数由后端 assembleReviewReport 决定，此处不写死） */}
              <div className="space-y-2">
                {report.sections.map((section) => (
                  <ReviewSectionRow key={section.key} section={section} />
                ))}
              </div>

              {/* 修改建议清单 */}
              <div>
                <p className="mb-1.5 text-sm font-medium">
                  修改建议（{report.suggestions.length}）
                </p>
                {report.suggestions.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    未发现明显问题，可直接导出。
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {report.suggestions.map((s, idx) => (
                      <li
                        key={idx}
                        className="border-border bg-card/50 flex items-start gap-2 rounded-lg border p-2 text-xs"
                      >
                        <span className="min-w-0 flex-1">{s.text}</span>
                        {s.sceneId && (
                          <button
                            type="button"
                            onClick={() => handleJump(s.sceneId!)}
                            className="text-primary hover:text-primary/80 flex shrink-0 items-center gap-0.5"
                            title="定位到该分镜"
                          >
                            <MapPin size={12} />
                            定位
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 单节展示行：状态圆点 + 标题 + 逐条 lines */
function ReviewSectionRow({ section }: { section: ReviewSection }) {
  return (
    <div className="border-border rounded-lg border p-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[section.status]}`}
        />
        <span className="text-sm font-medium">{section.title}</span>
      </div>
      <div className="text-muted-foreground mt-1 space-y-0.5 pl-4 text-xs">
        {section.lines.map((line, idx) => (
          <p key={idx}>{line}</p>
        ))}
      </div>
    </div>
  );
}
