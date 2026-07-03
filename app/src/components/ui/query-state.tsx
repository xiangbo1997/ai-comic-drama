"use client";

/**
 * 页面级三态（加载 / 失败 / 空）共享组件
 *
 * 背景：各页面三态实现不一——projects 页三态齐全是范本，characters /
 * settings 等页缺 error 分支，接口抖动时整页空白且无重试入口
 * （ux-crosscut P1-5）。这里把 projects 页的模式抽成可复用组件。
 */

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function LoadingState({ className = "py-20" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <Loader2 size={32} className="text-muted-foreground animate-spin" />
    </div>
  );
}

export function ErrorState({
  message = "加载失败，请重试",
  onRetry,
  className = "py-20",
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`text-center ${className}`}>
      <p className="text-destructive mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="border-border text-foreground hover:bg-secondary rounded-lg border px-4 py-2 transition"
        >
          重新加载
        </button>
      )}
    </div>
  );
}

/** 通用骨架块（配合 aspect / 高度类名拼装页面骨架） */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-secondary/60 animate-pulse rounded-lg ${className}`} />
  );
}

/** 卡片网格骨架（项目列表等 aspect-video 卡片场景） */
export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="border-border bg-card overflow-hidden rounded-xl border"
        >
          <Skeleton className="aspect-video rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 编辑器三栏布局骨架：新建项目跳转后的冷加载不再整屏白转圈 */
export function EditorSkeleton() {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      {/* 头部 */}
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      {/* 三栏 */}
      <div className="flex flex-1 overflow-hidden">
        <div className="border-border hidden w-[22%] space-y-3 border-r p-4 md:block">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex-1 space-y-3 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="aspect-video w-32 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-border hidden w-[30%] space-y-3 border-l p-4 md:block">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    </div>
  );
}

/** 三态编排：query 状态 → 对应 UI；三态都通过后渲染 children */
export function QueryState({
  isLoading,
  isError,
  onRetry,
  errorMessage,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  errorMessage?: string;
  children: ReactNode;
}) {
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={errorMessage} onRetry={onRetry} />;
  return <>{children}</>;
}
