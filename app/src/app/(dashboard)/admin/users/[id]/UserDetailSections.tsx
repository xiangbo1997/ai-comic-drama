"use client";

/**
 * 详情页的只读区块：统计卡片 + 积分流水 / 订单 / 审计记录三张表
 *
 * 都是纯展示组件（数据由详情页注入），拆出来让页面主体只负责编排动作与状态。
 */

import { DataTable, type DataTableColumn } from "../../components/DataTable";
import {
  formatDateTime,
  type AdminCreditTransaction,
  type AdminUserAuditLog,
  type AdminUserOrder,
  type AdminUserStats,
} from "../types";

/** 统计卡片 */
export function StatsCards({
  stats,
  isLoading,
}: {
  stats?: AdminUserStats;
  isLoading: boolean;
}) {
  const cards: Array<{ label: string; value: string }> = [
    { label: "项目数", value: String(stats?.projects ?? 0) },
    { label: "角色数", value: String(stats?.characters ?? 0) },
    { label: "系列数", value: String(stats?.series ?? 0) },
    { label: "已支付订单", value: String(stats?.ordersPaid ?? 0) },
    {
      label: "累计支付金额",
      value: `¥${(stats?.totalPaidAmount ?? 0).toFixed(2)}`,
    },
    {
      label: "近 30 天消耗积分",
      value: (stats?.creditsSpent30d ?? 0).toLocaleString("zh-CN"),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="border-border rounded-lg border px-4 py-3"
        >
          <div className="text-muted-foreground text-xs">{card.label}</div>
          <div className="text-foreground mt-1 text-lg font-semibold tabular-nums">
            {isLoading ? (
              <span className="bg-secondary inline-block h-6 w-16 animate-pulse rounded" />
            ) : (
              card.value
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const TRANSACTION_COLUMNS: DataTableColumn<AdminCreditTransaction>[] = [
  {
    key: "createdAt",
    header: "时间",
    render: (row) => (
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {formatDateTime(row.createdAt)}
      </span>
    ),
  },
  { key: "type", header: "类型", render: (row) => row.type },
  {
    key: "delta",
    header: "变动",
    className: "text-right",
    render: (row) => (
      <span
        className={
          row.delta >= 0
            ? "text-primary font-medium tabular-nums"
            : "text-destructive font-medium tabular-nums"
        }
      >
        {row.delta >= 0 ? `+${row.delta}` : row.delta}
      </span>
    ),
  },
  {
    key: "balanceAfter",
    header: "变动后余额",
    className: "text-right",
    render: (row) => <span className="tabular-nums">{row.balanceAfter}</span>,
  },
  {
    key: "note",
    header: "备注",
    render: (row) => (
      <span className="text-muted-foreground text-xs">
        {row.note || row.source || "—"}
      </span>
    ),
  },
];

export function TransactionsTable({
  rows,
  isLoading,
}: {
  rows: AdminCreditTransaction[];
  isLoading: boolean;
}) {
  return (
    <DataTable
      columns={TRANSACTION_COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      isLoading={isLoading}
      emptyText="暂无积分流水"
    />
  );
}

const ORDER_COLUMNS: DataTableColumn<AdminUserOrder>[] = [
  {
    key: "createdAt",
    header: "下单时间",
    render: (row) => (
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {formatDateTime(row.createdAt)}
      </span>
    ),
  },
  {
    key: "orderNo",
    header: "订单号",
    render: (row) => (
      <code className="text-muted-foreground font-mono text-xs">
        {row.orderNo}
      </code>
    ),
  },
  { key: "productName", header: "商品", render: (row) => row.productName },
  {
    key: "amount",
    header: "金额",
    className: "text-right",
    render: (row) => (
      <span className="tabular-nums">¥{row.amount.toFixed(2)}</span>
    ),
  },
  {
    key: "credits",
    header: "积分",
    className: "text-right",
    render: (row) => <span className="tabular-nums">{row.credits}</span>,
  },
  {
    key: "status",
    header: "状态",
    render: (row) => (
      <span
        className={
          row.status === "PAID"
            ? "text-primary text-xs"
            : "text-muted-foreground text-xs"
        }
      >
        {row.status}
      </span>
    ),
  },
];

export function OrdersTable({
  rows,
  isLoading,
}: {
  rows: AdminUserOrder[];
  isLoading: boolean;
}) {
  return (
    <DataTable
      columns={ORDER_COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      isLoading={isLoading}
      emptyText="暂无订单"
    />
  );
}

/** 把 before/after 快照压成一行可读文本；快照结构不固定，故做通用序列化 */
function formatSnapshot(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}=${v === null ? "空" : String(v)}`)
    .join(" ");
}

const AUDIT_COLUMNS: DataTableColumn<AdminUserAuditLog>[] = [
  {
    key: "createdAt",
    header: "时间",
    render: (row) => (
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {formatDateTime(row.createdAt)}
      </span>
    ),
  },
  {
    key: "action",
    header: "动作",
    render: (row) => (
      <code className="bg-secondary/60 rounded px-1.5 py-0.5 font-mono text-[11px]">
        {row.action}
      </code>
    ),
  },
  { key: "actor", header: "操作者", render: (row) => row.actorEmail },
  {
    key: "change",
    header: "变更",
    render: (row) => (
      <span className="text-muted-foreground text-xs">
        {formatSnapshot(row.before)} → {formatSnapshot(row.after)}
      </span>
    ),
  },
  {
    key: "note",
    header: "备注",
    render: (row) => (
      <span className="text-muted-foreground text-xs">{row.note || "—"}</span>
    ),
  },
];

export function AuditTable({
  rows,
  isLoading,
}: {
  rows: AdminUserAuditLog[];
  isLoading: boolean;
}) {
  return (
    <DataTable
      columns={AUDIT_COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      isLoading={isLoading}
      emptyText="暂无针对该用户的管理操作记录"
    />
  );
}
