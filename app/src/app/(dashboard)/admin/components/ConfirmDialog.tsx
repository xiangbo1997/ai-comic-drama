"use client";

/**
 * 后台危险操作确认框
 *
 * 封禁、退款、扣积分这类动作都要「二次确认 + 填写理由」，理由随审计日志一起
 * 落库。确认回调是异步的：提交期间锁住按钮并展示错误，避免用户在网络慢时
 * 重复点击造成重复扣费。
 */

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** 确认按钮文案 */
  confirmText?: string;
  /** 确认按钮样式；危险操作传 destructive */
  confirmVariant?: "default" | "destructive";
  /** 是否展示理由输入框 */
  withReason?: boolean;
  /** 理由是否必填（withReason 为 true 时生效） */
  reasonRequired?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /**
   * 确认回调。抛出的错误会展示在弹窗内且**不关闭弹窗**，让用户能改了再试；
   * 正常返回则由本组件关闭弹窗。
   */
  onConfirm: (reason: string) => Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  confirmVariant = "default",
  withReason = false,
  reasonRequired = false,
  reasonLabel = "操作理由",
  reasonPlaceholder = "填写理由，将记入审计日志",
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次重新打开清空上一轮的输入与报错，避免串场。
  // 用「渲染期比较上一次的 open」而非 useEffect：effect 里 setState 会多跑一
  // 轮渲染（React 官方建议的 derived-state 写法，也是 lint 规则要求的形式）。
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setReason("");
      setError(null);
      setSubmitting(false);
    }
  }

  const handleConfirm = async () => {
    if (withReason && reasonRequired && !reason.trim()) {
      setError("请填写操作理由");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 提交进行中禁止关闭，避免用户以为已取消但请求仍在途
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {withReason && (
          <div className="space-y-2">
            <label
              htmlFor="confirm-dialog-reason"
              className="text-muted-foreground text-sm"
            >
              {reasonLabel}
              {reasonRequired && <span className="text-destructive"> *</span>}
            </label>
            <textarea
              id="confirm-dialog-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              disabled={submitting}
              className="border-border bg-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary/40 w-full rounded-lg border px-3 py-2 text-sm transition focus:ring-2 focus:outline-none disabled:opacity-50"
            />
          </div>
        )}

        {error && (
          <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting && <Loader2 className="animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
