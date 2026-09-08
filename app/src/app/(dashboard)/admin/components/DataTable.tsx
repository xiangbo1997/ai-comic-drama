"use client";

/**
 * 后台通用数据表
 *
 * 列定义驱动渲染，自带加载 / 空 / 错误三态。后台各模块（用户、订单、流水）
 * 的表格形态一致，抽在这里避免三份各写一遍骨架屏与空态文案。
 *
 * 刻意**不做**排序、分页、列宽拖拽：分页由调用方在表格外自行组织（游标与
 * 页码策略各模块不同），塞进来只会让这个组件变成谁都不敢改的怪物。
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  /** 列唯一键（同时用作 React key） */
  key: string;
  header: ReactNode;
  /** 单元格渲染；返回 ReactNode */
  render: (row: T) => ReactNode;
  /** 列附加类名（对齐、宽度等） */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** 行唯一键 */
  rowKey: (row: T) => string;
  isLoading?: boolean;
  /** 错误信息；非空时优先于空态展示 */
  error?: string | null;
  /** 空态文案 */
  emptyText?: string;
  /** 行点击回调；提供时行会显示为可点击 */
  onRowClick?: (row: T) => void;
}

/** 骨架屏行数：够撑起视觉高度，又不至于闪一大片 */
const SKELETON_ROWS = 5;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  error = null,
  emptyText = "暂无数据",
  onRowClick,
}: DataTableProps<T>) {
  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-secondary/50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "text-muted-foreground px-4 py-3 text-left font-medium whitespace-nowrap",
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading &&
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-border border-t">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <div className="bg-secondary h-4 w-full animate-pulse rounded" />
                  </td>
                ))}
              </tr>
            ))}

          {!isLoading && error && (
            <tr className="border-border border-t">
              <td
                colSpan={columns.length}
                className="text-destructive px-4 py-10 text-center"
              >
                {error}
              </td>
            </tr>
          )}

          {!isLoading && !error && rows.length === 0 && (
            <tr className="border-border border-t">
              <td
                colSpan={columns.length}
                className="text-muted-foreground px-4 py-10 text-center"
              >
                {emptyText}
              </td>
            </tr>
          )}

          {!isLoading &&
            !error &&
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-border border-t",
                  onRowClick && "hover:bg-secondary/40 cursor-pointer"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn("px-4 py-3 align-middle", col.className)}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
