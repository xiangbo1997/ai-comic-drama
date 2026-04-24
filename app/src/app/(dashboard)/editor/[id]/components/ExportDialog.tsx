"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";

interface ExportStatus {
  isExporting: boolean;
  taskId: string | null;
  progress: number;
  error: string | null;
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">导出视频</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded">
            <X size={20} />
          </button>
        </div>

        {exportStatus.isExporting ? (
          <div className="text-center py-8">
            <Loader2 size={40} className="animate-spin mx-auto mb-4 text-blue-500" />
            <p className="text-lg mb-2">正在导出...</p>
            <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${exportStatus.progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-400">{exportStatus.progress}%</p>
          </div>
        ) : exportStatus.error ? (
          <div className="text-center py-8">
            <p className="text-red-400 mb-4">{exportStatus.error}</p>
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
            >
              重试
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
        <label className="block text-sm text-gray-400 mb-1">格式</label>
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="w-full bg-gray-700 rounded-lg px-3 py-2">
          <option value="mp4">MP4 (推荐)</option>
          <option value="webm">WebM</option>
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-1">分辨率</label>
        <select value={quality} onChange={(e) => setQuality(e.target.value)} className="w-full bg-gray-700 rounded-lg px-3 py-2">
          <option value="480p">480p (标清)</option>
          <option value="720p">720p (高清)</option>
          <option value="1080p">1080p (全高清)</option>
        </select>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={includeSubtitles} onChange={(e) => setIncludeSubtitles(e.target.checked)} className="w-4 h-4 rounded bg-gray-700 border-gray-600" />
          <span>包含字幕</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} className="w-4 h-4 rounded bg-gray-700 border-gray-600" />
          <span>包含配音</span>
        </label>
      </div>
      <div className="flex gap-2 pt-4">
        <button onClick={onCancel} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg">取消</button>
        <button onClick={() => onExport({ format, quality, includeSubtitles, includeAudio })} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg">开始导出</button>
      </div>
    </div>
  );
}
