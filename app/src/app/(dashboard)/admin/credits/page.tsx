"use client";

/**
 * 积分流水页
 *
 * 全站积分变动流水：筛选（搜索 / 类型 / 用户 / 日期）+ 游标分页 + 汇总卡片。
 * 只读页面——积分的所有变动都必须由业务动作产生（充值、生成扣费、管理员在用户
 * 详情页发放/扣减），不在这里提供「凭空造一条流水」的入口。
 *
 * delta 按正负着色是这一页的核心信息密度：一眼扫出哪些行在发钱、哪些在收钱。
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-client";

import { AdminPageHeader } from "../components/AdminPageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { formatDateTime } from "../orders/types";

const PAGE_SIZE = 50;

/** 类型筛选下拉项；与服务端 TRANSACTION_TYPES 白名单一一对应 */
const TYPE_LABELS: Record<string, string> = {
  PAYMENT: "充值到账",
  SUBSCRIPTION: "订阅发放",
  CHECKIN: "签到奖励",
  INVITE: "邀请奖励",
  ADMIN_GRANT: "管理员发放",
  REFUND: "退款返还",
  GENERATE_IMAGE: "图像生成",
  GENERATE_VIDEO: "视频生成",
  GENERATE_TTS: "语音合成",
  GENERATE_REFERENCE: "参考图生成",
  GENERATE_SCRIPT: "剧本解析",
  ADMIN_DEDUCT: "管理员扣减",
};

interface CreditTransactionRow {
  id: string;
  userId: string;
  userEmail: string;
  delta: number;
  balanceAfter: number;
  type: string;
  source: string | null;
  sourceId: string | null;
  note: string | null;
  createdAt: string;
}

interface TransactionsResponse {
  items: CreditTransactionRow[];
  nextCursor: string | null;
  summary: { granted: number; charged: number };
}

const inputClass =
  "border-border bg-input text-foreground focus:border-primary focus:ring-primary/40 rounded-lg border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-50";

export default function AdminCreditsPage() {
  return (
    // useSearchParams 需要 Suspense 边界（Next.js App Router 要求）
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">加载中...</p>}
    >
      <CreditsPageInner />
    </Suspense>
  );
}

function CreditsPageInner() {
  const searchParams = useSearchParams();
  // 支持从用户详情页带 ?userId= 直接跳到该用户的流水
  const initialUserId = searchParams.get("userId") ?? "";

  const [draftQ, setDraftQ] = useState("");
  const [filters, setFilters] = useState({
    q: "",
    type: "",
    userId: initialUserId,
    from: "",
    to: "",
  });
  const [cursors, setCursors] = useState<string[]>([""]);

  const resetPaging = () => setCursors([""]);

  const buildQuery = (cursor: string) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    if (filters.q) params.set("q", filters.q);
    if (filters.type) params.set("type", filters.type);
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.from) params.set("from", new Date(filters.from).toISOString());
    if (filters.to) params.set("to", new Date(filters.to).toISOString());
    return params.toString();
  };

  const pages = useQuery({
    queryKey: ["admin-credit-transactions", filters, cursors],
    queryFn: async () => {
      const results: TransactionsResponse[] = [];
      for (const cursor of cursors) {
        results.push(
          await adminFetch<TransactionsResponse>(
            `/api/admin/credit-transactions?${buildQuery(cursor)}`
          )
        );
      }
      return results;
    },
  });

  const allPages = pages.data ?? [];
  const rows = allPages.flatMap((p) => p.items);
  const lastPage = allPages[allPages.length - 1];
  const summary = allPages[0]?.summary;

  const columns: DataTableColumn<CreditTransactionRow>[] = [
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
      key: "user",
      header: "用户",
      render: (row) => (
        <Link
          href={`/admin/users/${row.userId}`}
          className="text-primary text-xs hover:underline"
        >
          {row.userEmail}
        </Link>
      ),
    },
    {
      key: "type",
      header: "类型",
      render: (row) => (
        <span className="text-xs">{TYPE_LABELS[row.type] ?? row.type}</span>
      ),
    },
    {
      key: "delta",
      header: "变动",
      className: "text-right tabular-nums",
      render: (row) => (
        <span
          className={row.delta >= 0 ? "text-green-600" : "text-destructive"}
        >
          {row.delta > 0 ? `+${row.delta}` : row.delta}
        </span>
      ),
    },
    {
      key: "balanceAfter",
      header: "变动后余额",
      className: "text-right tabular-nums",
      render: (row) => <>{row.balanceAfter}</>,
    },
    {
      key: "source",
      header: "来源",
      render: (row) => (
        <span className="text-muted-foreground font-mono text-xs break-all">
          {row.source ?? "—"}
          {row.sourceId ? ` / ${row.sourceId}` : ""}
        </span>
      ),
    },
    {
      key: "note",
      header: "备注",
      render: (row) => (
        <span className="text-muted-foreground text-xs">{row.note ?? "—"}</span>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="积分流水"
        description="全站积分变动流水，支持按用户与类型筛选。本页只读——积分变动一律由业务动作产生。"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="发放合计（当前筛选）"
          value={summary ? `+${summary.granted}` : "—"}
          tone="positive"
        />
        <SummaryCard
          label="消耗合计（当前筛选）"
          value={summary ? `-${summary.charged}` : "—"}
          tone="negative"
        />
      </div>

      <div className="border-border mb-4 flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <FilterField label="搜索">
          <input
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setFilters((f) => ({ ...f, q: draftQ.trim() }));
                resetPaging();
              }
            }}
            placeholder="邮箱 / 关联ID / 备注"
            className={inputClass + " w-52"}
          />
        </FilterField>

        <FilterField label="类型">
          <select
            value={filters.type}
            onChange={(e) => {
              setFilters((f) => ({ ...f, type: e.target.value }));
              resetPaging();
            }}
            className={inputClass}
          >
            <option value="">全部</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="起始日期">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => {
              setFilters((f) => ({ ...f, from: e.target.value }));
              resetPaging();
            }}
            className={inputClass}
          />
        </FilterField>

        <FilterField label="截止日期">
          <input
            type="date"
            value={filters.to}
            onChange={(e) => {
              setFilters((f) => ({ ...f, to: e.target.value }));
              resetPaging();
            }}
            className={inputClass}
          />
        </FilterField>

        <Button
          size="sm"
          onClick={() => {
            setFilters((f) => ({ ...f, q: draftQ.trim() }));
            resetPaging();
          }}
        >
          查询
        </Button>

        {filters.userId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setFilters((f) => ({ ...f, userId: "" }));
              resetPaging();
            }}
          >
            清除用户筛选
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={pages.isLoading}
        error={
          pages.error
            ? pages.error instanceof Error
              ? pages.error.message
              : "加载失败"
            : null
        }
        emptyText="没有符合条件的流水"
      />

      {lastPage?.nextCursor && (
        <div className="mt-4 text-center">
          <Button
            variant="outline"
            size="sm"
            disabled={pages.isFetching}
            onClick={() =>
              setCursors((prev) => [...prev, lastPage.nextCursor as string])
            }
          >
            {pages.isFetching ? "加载中..." : "加载更多"}
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </label>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-green-600"
      : tone === "negative"
        ? "text-destructive"
        : "";
  return (
    <div className="border-border rounded-lg border px-4 py-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}
