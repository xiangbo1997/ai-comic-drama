"use client";

import { useState } from "react";
import { DEFAULT_WATERMARK, type Watermark } from "@/types/export-style";
import { WatermarkPanel } from "./WatermarkPanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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

  // 组件仅在父级为真时挂载，故恒为打开；关闭统一走 onClose。
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b px-5 py-4 text-left">
          <DialogTitle>品牌水印 / Logo（全片统一）</DialogTitle>
          <DialogDescription className="sr-only">
            设置全片统一的品牌水印或 Logo
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto p-5">
          <WatermarkPanel value={draft} onChange={setDraft} />
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
