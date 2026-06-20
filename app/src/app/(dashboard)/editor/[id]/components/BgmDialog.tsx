"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_BACKGROUND_MUSIC,
  type BackgroundMusic,
} from "@/types/export-style";
import { BgmPanel } from "./BgmPanel";

/**
 * 配乐 / 背景音乐弹窗（全片单条主 BGM）。
 * 本地 draft state 即时响应编辑，点「完成」才一次性保存——
 * 与水印/字幕样式弹窗同模式，避免每次 onChange 都 PATCH。
 */
export function BgmDialog({
  initialValue,
  projectId,
  onSave,
  onClose,
}: {
  initialValue?: BackgroundMusic;
  projectId: string;
  onSave: (backgroundMusic: BackgroundMusic) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BackgroundMusic>(
    initialValue ?? DEFAULT_BACKGROUND_MUSIC
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl">
        <div className="border-border flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">配乐 / 背景音乐（全片统一）</h2>
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded-lg p-1.5 transition"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <BgmPanel value={draft} onChange={setDraft} projectId={projectId} />
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
