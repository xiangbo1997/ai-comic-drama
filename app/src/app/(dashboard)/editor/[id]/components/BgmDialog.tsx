"use client";

import { useState } from "react";
import {
  DEFAULT_BACKGROUND_MUSIC,
  type BackgroundMusic,
} from "@/types/export-style";
import { BgmPanel } from "./BgmPanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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

  // 组件仅在父级为真时挂载，故恒为打开；关闭统一走 onClose。
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b px-5 py-4 text-left">
          <DialogTitle>配乐 / 背景音乐（全片统一）</DialogTitle>
          <DialogDescription className="sr-only">
            为全片设置统一的背景音乐
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto p-5">
          <BgmPanel value={draft} onChange={setDraft} projectId={projectId} />
        </div>
        <DialogFooter className="border-border shrink-0 justify-end gap-2 border-t px-5 py-3">
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
