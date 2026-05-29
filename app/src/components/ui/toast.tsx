"use client";

/**
 * 轻量 Toast 系统（P4）
 *
 * 替代项目中 22+ 处 alert()/confirm()（阻塞线程、样式失控、与品牌 UI 割裂）。
 * 零第三方依赖（当前环境无法新增 npm 包），基于 React Context + 设计系统 token 实现。
 *
 * 用法：
 *   const toast = useToast();
 *   toast.success("已保存");
 *   toast.error("生成失败");
 *   const ok = await toast.confirm("确定删除该项目？");
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";

type ToastKind = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ConfirmState {
  id: number;
  message: string;
  resolve: (ok: boolean) => void;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  /** 替代 window.confirm，返回 Promise<boolean> */
  confirm: (message: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLE: Record<
  ToastKind,
  { icon: typeof CheckCircle2; cls: string }
> = {
  success: { icon: CheckCircle2, cls: "text-primary" },
  error: { icon: XCircle, cls: "text-destructive" },
  info: { icon: Info, cls: "text-muted-foreground" },
  warning: { icon: AlertTriangle, cls: "text-primary" },
};

let counter = 0;
const nextId = () => ++counter;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId();
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove]
  );

  const api: ToastApi = {
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
    warning: (m) => push("warning", m),
    confirm: (message) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ id: nextId(), message, resolve });
      }),
  };

  const resolveConfirm = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Toast 堆叠（右上角） */}
      <div className="pointer-events-none fixed top-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => {
          const { icon: Icon, cls } = KIND_STYLE[t.kind];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-border bg-card p-3 shadow-lg"
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${cls}`} />
              <p className="flex-1 text-sm text-foreground">{t.message}</p>
              <button
                onClick={() => remove(t.id)}
                className="shrink-0 text-muted-foreground transition hover:text-foreground"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirm 对话框 */}
      {confirmState && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-start gap-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-primary" />
              <p className="text-sm text-foreground">{confirmState.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => resolveConfirm(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
              >
                取消
              </button>
              <button
                onClick={() => resolveConfirm(true)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast 必须在 <ToastProvider> 内使用");
  }
  return ctx;
}
