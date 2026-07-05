"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
} from "@/types/export-style";
import { SubtitleStylePanel } from "./SubtitleStylePanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * 字幕样式弹窗（全片统一）。
 * 用本地 state 即时响应编辑，点「完成」才一次性保存——
 * 避免每次 onChange 都 PATCH+invalidate 导致 value 被服务端旧值刷回（"修改不了"）。
 *
 * 可选「从配音识别」：父组件传入 onTranscribe 时显示按钮，
 * 调用语音识别把各分镜配音转为字幕（回填 dialogue）。
 */
export function SubtitleStyleDialog({
  initialValue,
  onSave,
  onClose,
  onTranscribe,
}: {
  initialValue?: SubtitleStyle;
  onSave: (style: SubtitleStyle) => void;
  onClose: () => void;
  /** 触发语音识别；resolve 返回提示信息（成功/无结果）。缺省则不显示按钮 */
  onTranscribe?: () => Promise<string>;
}) {
  const [draft, setDraft] = useState<SubtitleStyle>(
    initialValue ?? DEFAULT_SUBTITLE_STYLE
  );
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeMsg, setTranscribeMsg] = useState<string | null>(null);

  const handleTranscribe = async () => {
    if (!onTranscribe) return;
    setTranscribing(true);
    setTranscribeMsg(null);
    try {
      const msg = await onTranscribe();
      setTranscribeMsg(msg);
    } catch (err) {
      setTranscribeMsg(err instanceof Error ? err.message : "识别失败，请重试");
    } finally {
      setTranscribing(false);
    }
  };

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
          <DialogTitle>字幕样式（全片统一）</DialogTitle>
          <DialogDescription className="sr-only">
            设置全片统一的字幕样式，可选从配音识别生成字幕
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto p-5">
          {onTranscribe && (
            <div className="border-border mb-4 rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">智能字幕</p>
                  <p className="text-muted-foreground text-xs">
                    从各分镜配音自动识别生成字幕（回填台词）
                  </p>
                </div>
                <button
                  onClick={handleTranscribe}
                  disabled={transcribing}
                  className="bg-primary hover:bg-primary/90 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  {transcribing ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {transcribing ? "识别中..." : "从配音识别"}
                </button>
              </div>
              {transcribeMsg && (
                <p className="text-muted-foreground text-xs">{transcribeMsg}</p>
              )}
            </div>
          )}
          <SubtitleStylePanel value={draft} onChange={setDraft} />
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
