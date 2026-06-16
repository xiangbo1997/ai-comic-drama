"use client";

import { useState } from "react";
import { Loader2, X, Download, CheckCircle2 } from "lucide-react";

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
  }) => void;
  onClose: () => void;
  onRetry: () => void;
}

export function ExportDialog({
  isOpen,
  exportStatus,
  onExport,
  onClose,
  onRetry,
}: ExportDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card w-full max-w-md rounded-xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold">导出视频</h2>
          <button onClick={onClose} className="hover:bg-secondary rounded p-1">
            <X size={20} />
          </button>
        </div>

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
          <ExportForm onExport={onExport} onCancel={onClose} />
        )}
      </div>
    </div>
  );
}

function ExportForm({
  onExport,
  onCancel,
}: {
  onExport: (options: {
    format: string;
    quality: string;
    includeSubtitles: boolean;
    includeAudio: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("720p");
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [includeAudio, setIncludeAudio] = useState(true);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">格式</label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="bg-secondary w-full rounded-lg px-3 py-2"
        >
          <option value="mp4">MP4 (推荐)</option>
          <option value="webm">WebM</option>
        </select>
      </div>
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">
          分辨率
        </label>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          className="bg-secondary w-full rounded-lg px-3 py-2"
        >
          <option value="480p">480p (标清)</option>
          <option value="720p">720p (高清)</option>
          <option value="1080p">1080p (全高清)</option>
        </select>
      </div>
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
      <div className="flex gap-2 pt-4">
        <button
          onClick={onCancel}
          className="bg-secondary hover:bg-secondary/80 flex-1 rounded-lg px-4 py-2"
        >
          取消
        </button>
        <button
          onClick={() =>
            onExport({ format, quality, includeSubtitles, includeAudio })
          }
          className="bg-primary hover:bg-primary/90 flex-1 rounded-lg px-4 py-2"
        >
          开始导出
        </button>
      </div>
    </div>
  );
}
