"use client";

/**
 * 详情页的三个表单弹窗：积分调整 / 设置角色 / 重置密码
 *
 * 与 ConfirmDialog（纯确认 + 理由）的区别在于这些都要收结构化输入并做客户端
 * 预校验。抽成独立文件是为了让详情页主体保持在可读长度内。
 *
 * 提交失败时**不关闭弹窗**：管理员填了一长串理由，因为余额不足被拒就清空重
 * 填是不可接受的。
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { UserRole } from "@prisma/client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ROLE_LABELS } from "../types";

const INPUT_CLASS =
  "border-border bg-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary/40 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none disabled:opacity-50";

/** 与服务端 zod 上限保持一致 */
const MAX_AMOUNT = 1_000_000;

/** 弹窗内的提交状态与错误展示，三个弹窗共用 */
function useSubmitState() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, onDone: () => void) => {
    setSubmitting(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return { submitting, error, setError, run };
}

export interface CreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前余额，用于实时预览调整后的结果 */
  currentCredits: number;
  onSubmit: (params: {
    direction: "grant" | "deduct";
    amount: number;
    note: string;
  }) => Promise<void>;
}

export function CreditsDialog({
  open,
  onOpenChange,
  currentCredits,
  onSubmit,
}: CreditsDialogProps) {
  const [direction, setDirection] = useState<"grant" | "deduct">("grant");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { submitting, error, setError, run } = useSubmitState();

  // 重开时清空上一轮输入（渲染期比较写法，与 ConfirmDialog 一致）
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDirection("grant");
      setAmount("");
      setNote("");
      setError(null);
    }
  }

  const parsedAmount = Number(amount);
  const amountValid =
    amount.trim() !== "" &&
    Number.isInteger(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= MAX_AMOUNT;
  const preview = amountValid
    ? direction === "grant"
      ? currentCredits + parsedAmount
      : currentCredits - parsedAmount
    : null;
  const insufficient = preview !== null && preview < 0;

  const handleSubmit = () => {
    if (!amountValid) {
      setError(`积分必须是 1 ~ ${MAX_AMOUNT} 的整数`);
      return;
    }
    if (!note.trim()) {
      setError("请填写操作理由，将记入审计日志");
      return;
    }
    if (insufficient) {
      setError(`余额不足：当前 ${currentCredits}，无法扣减 ${parsedAmount}`);
      return;
    }
    void run(
      () => onSubmit({ direction, amount: parsedAmount, note: note.trim() }),
      () => onOpenChange(false)
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>调整积分</DialogTitle>
          <DialogDescription>
            积分变动会立即生效并写入流水与审计日志，无法撤销，请谨慎操作。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={direction === "grant" ? "default" : "outline"}
              size="sm"
              disabled={submitting}
              onClick={() => setDirection("grant")}
            >
              充值
            </Button>
            <Button
              type="button"
              variant={direction === "deduct" ? "destructive" : "outline"}
              size="sm"
              disabled={submitting}
              onClick={() => setDirection("deduct")}
            >
              扣减
            </Button>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="credits-amount"
              className="text-muted-foreground text-sm"
            >
              积分数量 <span className="text-destructive">*</span>
            </label>
            <input
              id="credits-amount"
              type="number"
              min={1}
              max={MAX_AMOUNT}
              step={1}
              value={amount}
              disabled={submitting}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              placeholder="例如 100"
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="credits-note"
              className="text-muted-foreground text-sm"
            >
              操作理由 <span className="text-destructive">*</span>
            </label>
            <textarea
              id="credits-note"
              rows={3}
              value={note}
              disabled={submitting}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              placeholder="如：生成失败补偿 / 活动奖励 / 误充回收"
              className={INPUT_CLASS}
            />
          </div>

          <div className="bg-secondary/50 rounded-lg px-3 py-2 text-sm">
            <span className="text-muted-foreground">调整后余额：</span>
            <span className="tabular-nums">
              {currentCredits.toLocaleString("zh-CN")}
            </span>
            <span className="text-muted-foreground"> → </span>
            <span
              className={
                insufficient
                  ? "text-destructive font-medium tabular-nums"
                  : "text-primary font-medium tabular-nums"
              }
            >
              {preview === null ? "—" : preview.toLocaleString("zh-CN")}
            </span>
          </div>
        </div>

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
            variant={direction === "deduct" ? "destructive" : "default"}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="animate-spin" />}
            确认{direction === "grant" ? "充值" : "扣减"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRole: UserRole;
  onSubmit: (role: UserRole) => Promise<void>;
}

const ROLE_VALUES: UserRole[] = ["USER", "ADMIN", "SUPER_ADMIN"];

export function RoleDialog({
  open,
  onOpenChange,
  currentRole,
  onSubmit,
}: RoleDialogProps) {
  const [role, setRole] = useState<UserRole>(currentRole);
  const { submitting, error, setError, run } = useSubmitState();

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setRole(currentRole);
      setError(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置角色</DialogTitle>
          <DialogDescription>
            提升为管理员后该用户可进入后台。降级会立即生效，其正在进行的后台操作将被拒绝。
          </DialogDescription>
        </DialogHeader>

        <select
          value={role}
          disabled={submitting}
          onChange={(e) => setRole(e.target.value as UserRole)}
          aria-label="选择角色"
          className={INPUT_CLASS}
        >
          {ROLE_VALUES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>

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
            onClick={() =>
              void run(
                () => onSubmit(role),
                () => onOpenChange(false)
              )
            }
            disabled={submitting || role === currentRole}
          >
            {submitting && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface PasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (newPassword: string) => Promise<void>;
}

/** 与 lib/auth.ts 的注册校验一致：8 ~ 128 位 */
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

export function PasswordDialog({
  open,
  onOpenChange,
  onSubmit,
}: PasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { submitting, error, setError, run } = useSubmitState();

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPassword("");
      setConfirm("");
      setError(null);
    }
  }

  const handleSubmit = () => {
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      setError(`密码需为 ${MIN_PASSWORD} ~ ${MAX_PASSWORD} 位`);
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    void run(
      () => onSubmit(password),
      () => onOpenChange(false)
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重置密码</DialogTitle>
          <DialogDescription>
            重置后该用户的原密码立即失效，请通过可靠渠道告知新密码。此操作不可撤销。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor="new-password"
              className="text-muted-foreground text-sm"
            >
              新密码 <span className="text-destructive">*</span>
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={submitting}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder={`${MIN_PASSWORD} ~ ${MAX_PASSWORD} 位`}
              className={INPUT_CLASS}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="confirm-password"
              className="text-muted-foreground text-sm"
            >
              确认新密码 <span className="text-destructive">*</span>
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              disabled={submitting}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError(null);
              }}
              className={INPUT_CLASS}
            />
          </div>
        </div>

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
            variant="destructive"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="animate-spin" />}
            确认重置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string | null;
  onSubmit: (name: string) => Promise<void>;
}

export function NameDialog({
  open,
  onOpenChange,
  currentName,
  onSubmit,
}: NameDialogProps) {
  const [name, setName] = useState(currentName ?? "");
  const { submitting, error, setError, run } = useSubmitState();

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName(currentName ?? "");
      setError(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>修改昵称</DialogTitle>
          <DialogDescription>留空表示清除昵称。</DialogDescription>
        </DialogHeader>

        <input
          type="text"
          value={name}
          maxLength={50}
          disabled={submitting}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="最长 50 字"
          aria-label="昵称"
          className={INPUT_CLASS}
        />

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
            onClick={() =>
              void run(
                () => onSubmit(name.trim()),
                () => onOpenChange(false)
              )
            }
            disabled={submitting}
          >
            {submitting && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
