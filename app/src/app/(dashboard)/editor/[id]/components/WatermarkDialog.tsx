"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { DEFAULT_WATERMARK, type Watermark } from "@/types/export-style";
import { WatermarkPanel } from "./WatermarkPanel";

/**
 * 品牌水印弹窗（全片统一）。
 * 本地 draft state 即时响应编辑，点「完成」才一次性保存——
 * 与字幕样式弹窗同模式，避免每次 onChange 都 PATCH 导致改动被刷回。
 */
export function WatermarkDialog({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue?: Watermark;
  onSave: (watermark: Watermark) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Watermark>(
    initialValue ?? DEFAULT_WATERMARK
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl">
        <div className="border-border flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">品牌水印 / Logo（全片统一）</h2>
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded-lg p-1.5 transition"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <WatermarkPanel value={draft} onChange={setDraft} />
        </div>
        <div className="border-border flex shrink-0 justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded-lg px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="bg-primary hover:bg-primary/90 rounded-lg px-4 py-2 text-sm"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
