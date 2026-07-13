"use client";

import { Check, Loader2, Sparkles, Star } from "lucide-react";
import type { ReferenceCandidate } from "./constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface ReferenceCandidateGalleryProps {
  candidates: ReferenceCandidate[];
  /** 正在提交某张（其 imageUrl）时的加载态；null 表示无提交进行中 */
  selectingUrl: string | null;
  onSelect: (imageUrl: string) => void;
  onClose: () => void;
}

/**
 * 参考图多候选画廊（批次 2 · 1.4B）。
 *
 * 2×2 栅格展示 N 张候选，显示 VLM 分数徽章与「推荐」高亮，点选一张入库。
 * 候选生成阶段已扣费（按成功张数），点选只是选择入库哪张，不产生额外扣费。
 */
export function ReferenceCandidateGallery({
  candidates,
  selectingUrl,
  onSelect,
  onClose,
}: ReferenceCandidateGalleryProps) {
  const busy = selectingUrl !== null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // 提交进行中不允许关闭，避免中断入库
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b p-4 text-left">
          <DialogTitle>挑选参考图</DialogTitle>
          <DialogDescription>
            共生成 {candidates.length} 张候选，点选一张作为角色参考图入库
            {candidates.some((c) => c.vlmScore !== null) &&
              "（分数越高越贴合角色）"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            {candidates.map((c) => {
              const isSelecting = selectingUrl === c.imageUrl;
              return (
                <button
                  key={c.imageUrl}
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(c.imageUrl)}
                  className={`group relative overflow-hidden rounded-lg border-2 transition disabled:cursor-not-allowed ${
                    c.recommended
                      ? "border-agent"
                      : "border-border hover:border-muted-foreground"
                  }`}
                  title={c.recommended ? "推荐张（AI 择优）" : "点选入库"}
                >
                  <img
                    src={c.imageUrl}
                    alt="候选参考图"
                    className="aspect-square w-full object-cover"
                  />
                  {/* 推荐角标 */}
                  {c.recommended && (
                    <span className="bg-agent text-agent-foreground absolute top-1.5 left-1.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium">
                      <Star size={9} className="fill-current" />
                      推荐
                    </span>
                  )}
                  {/* VLM 分数徽章（有分才显示） */}
                  {typeof c.vlmScore === "number" && (
                    <span className="bg-background/85 text-foreground absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]">
                      <Sparkles size={9} />
                      {c.vlmScore}
                    </span>
                  )}
                  {/* hover 选择提示 / 提交加载态 */}
                  <span
                    className={`absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white transition ${
                      isSelecting
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {isSelecting ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <span className="flex items-center gap-1">
                        <Check size={16} /> 选这张
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
