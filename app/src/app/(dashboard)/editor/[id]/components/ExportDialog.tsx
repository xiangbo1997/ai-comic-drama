"use client";

import { useState } from "react";
import { Loader2, X, Download, CheckCircle2, ChevronDown } from "lucide-react";
import {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_WATERMARK,
  type SubtitleStyle,
  type Watermark,
} from "@/types/export-style";
import { SubtitleStylePanel } from "./SubtitleStylePanel";
import { WatermarkPanel } from "./WatermarkPanel";

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
  /** 时间轴入口已配置的字幕样式，作为导出表单初值（保持三处一致） */
  initialSubtitleStyle?: SubtitleStyle;
  /** 时间轴入口已配置的品牌水印，作为导出表单初值（保持三处一致） */
  initialWatermark?: Watermark;
}

export function ExportDialog({
  isOpen,
  exportStatus,
  onExport,
  onClose,
  onRetry,
  initialSubtitleStyle,
  initialWatermark,
}: ExportDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      {/* 弹窗主体 — 限高可滚动 */}
      <div className="bg-card flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl">
        {/* 标题栏 */}
        <div className="border-border flex shrink-0 items-center justify-between border-b p-6 pb-4">
          <h2 className="text-xl font-semibold">导出视频</h2>
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded p-1"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

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
              <a
                href={exportStatus.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="bg-primary hover:bg-primary/90 mx-auto flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-sm"
              >
                <Download size={16} />
                下载视频
              </a>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground mt-3 text-sm"
              >
                关闭
              </button>
            </div>
          ) : (
            <ExportForm
              onExport={onExport}
              onCancel={onClose}
              initialSubtitleStyle={initialSubtitleStyle}
              initialWatermark={initialWatermark}
            />
          )}
        </div>
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
