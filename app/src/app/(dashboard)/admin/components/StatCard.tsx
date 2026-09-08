/**
 * 后台指标卡
 *
 * 仪表盘顶部的「大数字 + 副标题」单元。抽出来是因为四张卡的骨架完全一致，
 * 内联写四遍后改间距要改四处。加载态显示骨架条而非 0——展示一个假的 0 会让
 * 管理员误以为「今天真的没有新用户」。
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  /** 主数值；加载中传 undefined 以显示骨架 */
  value: ReactNode;
  /** 次要说明（同比、拆分口径等） */
  hint?: ReactNode;
  isLoading?: boolean;
  /** 数值着色（异常指标标红等） */
  valueClassName?: string;
}

export function StatCard({
  label,
  value,
  hint,
  isLoading = false,
  valueClassName,
}: StatCardProps) {
  return (
    <div className="border-border bg-card rounded-lg border px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      {isLoading ? (
        <div className="bg-secondary mt-2 h-7 w-20 animate-pulse rounded" />
      ) : (
        <p
          className={cn(
            "text-foreground mt-1 text-2xl font-semibold tabular-nums",
            valueClassName
          )}
        >
          {value}
        </p>
      )}
      {hint && !isLoading && (
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      )}
    </div>
  );
}
