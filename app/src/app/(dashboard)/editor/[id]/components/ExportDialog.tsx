"use client";

import { useState } from "react";
import {
  Loader2,
  Download,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  MapPin,
} from "lucide-react";
import {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_WATERMARK,
  type SubtitleStyle,
  type Watermark,
} from "@/types/export-style";
import type {
  ReviewReport,
  ReviewSection,
  ReviewSectionStatus,
} from "@/lib/review-report";
import { SubtitleStylePanel } from "./SubtitleStylePanel";
import { WatermarkPanel } from "./WatermarkPanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface ExportStatus {
  isExporting: boolean;
  taskId: string | null;
  progress: number;
  error: string | null;
  videoUrl?: string | null;
}

interface ExportDialogProps {
  isOpen: boolean;
  exportStatus: ExportStatus;
  /** 项目 ID，用于拉取审片报告 */
  projectId: string;
  onExport: (options: {
    format: string;
    quality: string;
    includeSubtitles: boolean;
    includeAudio: boolean;
    subtitleStyle: SubtitleStyle;
    watermark: Watermark;
  }) => void;
  onClose: () => void;
  onRetry: () => void;
  /** 审片报告建议条目「定位」→ 选中该分镜并关闭弹窗 */
  onJumpToScene: (sceneId: string) => void;
  /** 时间轴入口已配置的字幕样式，作为导出表单初值（保持三处一致） */
  initialSubtitleStyle?: SubtitleStyle;
  /** 时间轴入口已配置的品牌水印，作为导出表单初值（保持三处一致） */
  initialWatermark?: Watermark;
}

export function ExportDialog({
  isOpen,
  exportStatus,
  projectId,
  onExport,
  onClose,
  onRetry,
  onJumpToScene,
  initialSubtitleStyle,
  initialWatermark,
}: ExportDialogProps) {
  // 下载视频：视频在 R2 跨域，前端直接 fetch 被 CORS 拦（Failed to fetch），
  // <a download> 对跨域资源也无效（变新标签打开）。改走同源下载代理
  // /api/download——服务端拉取（无浏览器跨域限制）+ Content-Disposition: attachment
  // 头，浏览器直接触发下载。<a> 导航不受 CORS 约束，失败由浏览器自身提示。
  const handleDownload = (url: string) => {
    const a = document.createElement("a");
    a.href = `/api/download?url=${encodeURIComponent(url)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* 弹窗主体 — 限高可滚动 */}
      <DialogContent className="flex max-h-[90vh] flex-col p-0">
        {/* 标题栏 */}
        <DialogHeader className="border-border shrink-0 border-b p-6 pb-4 text-left">
          <DialogTitle className="text-xl">导出视频</DialogTitle>
          <DialogDescription className="sr-only">
            配置导出格式、分辨率与字幕水印，生成最终视频
          </DialogDescription>
        </DialogHeader>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {exportStatus.isExporting ? (
            <div className="py-8 text-center">
              <Loader2
                size={40}
                className="text-primary mx-auto mb-4 animate-spin"
              />
              <p className="mb-2 text-lg">正在导出...</p>
              <div className="bg-secondary mb-2 h-2 w-full rounded-full">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${exportStatus.progress}%` }}
                />
              </div>
              <p className="text-muted-foreground text-sm">
                {exportStatus.progress}%
              </p>
            </div>
          ) : exportStatus.error ? (
            <div className="py-8 text-center">
              <p className="mb-4 text-red-400">{exportStatus.error}</p>
              <button
                onClick={onRetry}
                className="bg-secondary hover:bg-secondary/80 rounded-lg px-4 py-2"
              >
                重试
              </button>
            </div>
          ) : exportStatus.videoUrl ? (
            <div className="py-8 text-center">
              <CheckCircle2 size={40} className="text-primary mx-auto mb-4" />
              <p className="mb-4 text-lg">导出完成</p>
              <button
                onClick={() => handleDownload(exportStatus.videoUrl!)}
                className="bg-primary hover:bg-primary/90 mx-auto flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-sm"
              >
                <Download size={16} />
                下载视频
              </button>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground mt-3 text-sm"
              >
                关闭
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 审片报告（导出动作之上）：先体检再导出 */}
              <ReviewReportSection
                projectId={projectId}
                onJumpToScene={onJumpToScene}
                onClose={onClose}
              />
              <ExportForm
                onExport={onExport}
                onCancel={onClose}
                initialSubtitleStyle={initialSubtitleStyle}
                initialWatermark={initialWatermark}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
function ReviewReportSection({
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
              点右上角「生成审片报告」，导出前做一次确定性体检（时长节奏 /
              结尾钩子 / 连贯性 / 素材完整性）。
            </p>
          )}

          {report && (
            <>
              {/* 四节 */}
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

/** 可折叠分节组件 */
function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-border rounded-lg border">
      {/* 节标题 */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="hover:bg-secondary/50 flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium transition-colors"
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* 折叠内容 */}
      {open && (
        <div className="border-border border-t px-4 pt-3 pb-4">{children}</div>
      )}
    </div>
  );
}

function ExportForm({
  onExport,
  onCancel,
  initialSubtitleStyle,
  initialWatermark,
}: {
  onExport: (options: {
    format: string;
    quality: string;
    includeSubtitles: boolean;
    includeAudio: boolean;
    subtitleStyle: SubtitleStyle;
    watermark: Watermark;
  }) => void;
  onCancel: () => void;
  initialSubtitleStyle?: SubtitleStyle;
  initialWatermark?: Watermark;
}) {
  /* ---- 基础导出选项（保持原有字段不破坏） ---- */
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("720p");
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [includeAudio, setIncludeAudio] = useState(true);

  /* ---- 字幕样式状态：优先用时间轴入口已存配置，回退默认 ---- */
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(
    initialSubtitleStyle ?? DEFAULT_SUBTITLE_STYLE
  );

  /* ---- 水印状态：优先用时间轴入口已存配置，回退默认（关闭） ---- */
  const [watermark, setWatermark] = useState<Watermark>(
    initialWatermark ?? DEFAULT_WATERMARK
  );

  const handleExport = () => {
    onExport({
      format,
      quality,
      includeSubtitles,
      includeAudio,
      subtitleStyle,
      watermark,
    });
  };

  return (
    <div className="space-y-4">
      {/* 格式 */}
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">格式</label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 focus:ring-2 focus:outline-none"
        >
          <option value="mp4">MP4 (推荐)</option>
          <option value="webm">WebM</option>
        </select>
      </div>

      {/* 分辨率 */}
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">
          分辨率
        </label>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 focus:ring-2 focus:outline-none"
        >
          <option value="480p">480p (标清)</option>
          <option value="720p">720p (高清)</option>
          <option value="1080p">1080p (全高清)</option>
        </select>
      </div>

      {/* 基础开关 */}
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={includeSubtitles}
            onChange={(e) => setIncludeSubtitles(e.target.checked)}
            className="border-border bg-secondary h-4 w-4 rounded"
          />
          <span>包含字幕</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={includeAudio}
            onChange={(e) => setIncludeAudio(e.target.checked)}
            className="border-border bg-secondary h-4 w-4 rounded"
          />
          <span>包含配音</span>
        </label>
      </div>

      {/* ---- 字幕样式（可折叠分节） ---- */}
      <CollapsibleSection title="字幕样式">
        {includeSubtitles ? (
          <SubtitleStylePanel
            value={subtitleStyle}
            onChange={setSubtitleStyle}
            // 导出表单里保持只读预览（无底板图 + 不可拖拽），字幕位置/字号在
            // 时间轴字幕样式弹窗里可视化编辑，此处仅确认样式。
            interactive={false}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            请先勾选「包含字幕」以配置字幕样式。
          </p>
        )}
      </CollapsibleSection>

      {/* ---- 品牌水印（可折叠分节） ---- */}
      <CollapsibleSection title="品牌水印">
        <WatermarkPanel value={watermark} onChange={setWatermark} />
      </CollapsibleSection>

      {/* 底部操作按钮 */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          className="bg-secondary hover:bg-secondary/80 flex-1 rounded-lg px-4 py-2"
        >
          取消
        </button>
        <button
          onClick={handleExport}
          className="bg-primary hover:bg-primary/90 flex-1 rounded-lg px-4 py-2"
        >
          开始导出
        </button>
      </div>
    </div>
  );
}
