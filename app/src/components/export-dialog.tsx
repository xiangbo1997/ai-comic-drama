"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2, X, Check, AlertCircle } from "lucide-react";

interface ExportDialogProps {
  projectId: string;
  scenesCount: number;
  onClose: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function startExport(projectId: string, options: any) {
  const res = await fetch(`/api/projects/${projectId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Export failed");
  }
  return res.json();
}

export function ExportDialog({ projectId, scenesCount, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("720p");
  const [includeSubtitles, setIncludeSubtitles] = useState(true);

  const exportMutation = useMutation({
    mutationFn: () => startExport(projectId, { format, quality, includeSubtitles }),
  });

  const handleExport = () => {
    exportMutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">导出视频</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded"
          >
            <X size={20} />
          </button>
        </div>

        {exportMutation.isSuccess ? (
          // Success State
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check size={32} />
            </div>
            <h3 className="text-lg font-medium mb-2">导出任务已创建</h3>
            <p className="text-gray-400 text-sm mb-6">
              视频正在后台合成中，完成后将通知您下载
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              确定
            </button>
          </div>
        ) : exportMutation.isError ? (
          // Error State
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-lg font-medium mb-2">导出失败</h3>
            <p className="text-gray-400 text-sm mb-6">
              {exportMutation.error?.message || "请稍后重试"}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                重试
              </button>
            </div>
          </div>
        ) : (
          // Form
          <>
            <div className="space-y-4 mb-6">
              {/* Info */}
              <div className="bg-gray-700/50 rounded-lg p-4">
                <p className="text-sm text-gray-400">
                  将导出 <span className="text-white font-medium">{scenesCount}</span> 个分镜的视频
                </p>
              </div>

              {/* Format */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">格式</label>
                <div className="flex gap-2">
                  {["mp4", "webm", "mov"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                        format === f
                          ? "bg-blue-600"
                          : "bg-gray-700 hover:bg-gray-600"
                      }`}
                    >
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">质量</label>
                <div className="flex gap-2">
                  {[
                    { value: "480p", label: "480p" },
                    { value: "720p", label: "720p" },
                    { value: "1080p", label: "1080p" },
                  ].map((q) => (
                    <button
                      key={q.value}
                      onClick={() => setQuality(q.value)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                        quality === q.value
                          ? "bg-blue-600"
                          : "bg-gray-700 hover:bg-gray-600"
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subtitles */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-400">包含字幕</label>
                <button
                  onClick={() => setIncludeSubtitles(!includeSubtitles)}
                  className={`w-12 h-6 rounded-full transition ${
                    includeSubtitles ? "bg-blue-600" : "bg-gray-600"
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      includeSubtitles ? "translate-x-6" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                disabled={exportMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {exportMutation.isPending ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Download size={18} />
                )}
                {exportMutation.isPending ? "处理中..." : "开始导出"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
