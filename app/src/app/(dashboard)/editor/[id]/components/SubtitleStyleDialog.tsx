"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
} from "@/types/export-style";
import { SubtitleStylePanel } from "./SubtitleStylePanel";

/**
 * 字幕样式弹窗（全片统一）。
 * 用本地 state 即时响应编辑，点「完成」才一次性保存——
 * 避免每次 onChange 都 PATCH+invalidate 导致 value 被服务端旧值刷回（"修改不了"）。
 */
export function SubtitleStyleDialog({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue?: SubtitleStyle;
  onSave: (style: SubtitleStyle) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SubtitleStyle>(
    initialValue ?? DEFAULT_SUBTITLE_STYLE
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl">
        <div className="border-border flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">字幕样式（全片统一）</h2>
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded-lg p-1.5 transition"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <SubtitleStylePanel value={draft} onChange={setDraft} />
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
