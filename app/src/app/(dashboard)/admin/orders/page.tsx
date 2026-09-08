"use client";

/**
 * 订单管理页
 *
 * 筛选 + 游标分页列表 + 汇总卡片；点行打开详情抽屉，抽屉里做「标记已支付」
 * 与「退款」两个危险动作（都走 ConfirmDialog 二次确认 + 必填理由）。
 *
 * 分页用「加载更多」而非页码：游标分页天然只能前进，硬做页码会退化成 offset
 * 分页并在数据插入时错行。
 *
 * 两个动作都需要超级管理员；普通管理员进来按钮禁用并给出说明，与系统设置页
 * 的处理方式一致（服务端仍是唯一防线）。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-client";

import { AdminPageHeader } from "../components/AdminPageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { OrderDetailDrawer } from "./OrderDetailDrawer";
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  formatDateTime,
  type AdminOrder,
  type OrdersResponse,
} from "./types";

/** 每页条数：后台表格一屏能看完的量，配合「加载更多」 */
const PAGE_SIZE = 30;

export default function AdminOrdersPage() {
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
  const queryClient = useQueryClient();

  // ── 筛选草稿 vs 生效值：输入框改动不立刻打请求，点「查询」才生效 ──
  const [draftQ, setDraftQ] = useState("");
  const [filters, setFilters] = useState({
    q: "",
    status: "",
    type: "",
    method: "",
    from: "",
    to: "",
  });

  // 已加载的所有页拼在一起；换筛选条件时清空
  const [cursors, setCursors] = useState<string[]>([""]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [markPaidTarget, setMarkPaidTarget] = useState<AdminOrder | null>(null);
  const [refundTarget, setRefundTarget] = useState<AdminOrder | null>(null);
  const [refundDeduct, setRefundDeduct] = useState(true);
  const [markPaidMethod, setMarkPaidMethod] = useState("WECHAT");
  const [markPaidId, setMarkPaidId] = useState("");

  const buildQuery = (cursor: string) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (filters.type) params.set("type", filters.type);
    if (filters.method) params.set("method", filters.method);
    if (filters.from) params.set("from", new Date(filters.from).toISOString());
    if (filters.to) params.set("to", new Date(filters.to).toISOString());
    return params.toString();
  };

  // 每个游标一个 query，结果按顺序拼接——比手动维护累加数组更容易保持一致
  const pages = useQuery({
    queryKey: ["admin-orders", filters, cursors],
    queryFn: async () => {
      const results: OrdersResponse[] = [];
      for (const cursor of cursors) {
        results.push(
          await adminFetch<OrdersResponse>(
            `/api/admin/orders?${buildQuery(cursor)}`
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

  const resetPaging = () => setCursors([""]);

  const markPaidMutation = useMutation({
    mutationFn: (vars: { id: string; note: string }) =>
      adminFetch<{ status: string }>(`/api/admin/orders/${vars.id}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({
          paymentMethod: markPaidMethod,
          paymentId: markPaidId.trim() || undefined,
          note: vars.note,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-order-detail"] });
      setMarkPaidId("");
    },
  });

  const refundMutation = useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      adminFetch<{ status: string; clawedBack: number }>(
        `/api/admin/orders/${vars.id}/refund`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: vars.reason,
            deductCredits: refundDeduct,
          }),
        }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-order-detail"] });
    },
  });

  const columns: DataTableColumn<AdminOrder>[] = [
    {
      key: "orderNo",
      header: "订单号",
      render: (row) => <span className="font-mono text-xs">{row.orderNo}</span>,
    },
    {
      key: "user",
      header: "用户",
      render: (row) => <span className="text-xs">{row.userEmail}</span>,
    },
    {
      key: "product",
      header: "商品",
      render: (row) => (
        <div>
          <div>{row.productName}</div>
          <div className="text-muted-foreground text-xs">
            {ORDER_TYPE_LABELS[row.type]}
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "金额",
      className: "text-right tabular-nums",
      render: (row) => <>¥{row.amount}</>,
    },
    {
      key: "credits",
      header: "积分",
      className: "text-right tabular-nums",
      render: (row) => <>{row.credits}</>,
    },
    {
      key: "status",
      header: "状态",
      render: (row) => (
        <span className={statusClass(row.status)}>
          {ORDER_STATUS_LABELS[row.status]}
        </span>
      ),
    },
    {
      key: "method",
      header: "支付方式",
      render: (row) => (
        <span className="text-xs">
          {row.paymentMethod ? PAYMENT_METHOD_LABELS[row.paymentMethod] : "—"}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "创建时间",
      render: (row) => (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="订单管理"
        description="订单列表、支付状态核对、手工标记与退款。退款只改系统内状态，真实退款需在支付渠道后台操作。"
      />

      {!isSuperAdmin && (
        <p className="border-border text-muted-foreground mb-4 rounded-lg border px-4 py-3 text-sm">
          你的角色为普通管理员，可查看订单但不能标记支付或退款。
        </p>
      )}

      {/* 汇总卡片 */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="订单数（当前筛选）"
          value={summary ? String(summary.count) : "—"}
        />
        <SummaryCard
          label="已支付金额"
          value={summary ? `¥${summary.paidAmount}` : "—"}
        />
      </div>

      {/* 筛选栏 */}
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
            placeholder="订单号 / 邮箱 / 流水号"
            className={inputClass + " w-52"}
          />
        </FilterField>

        <FilterField label="状态">
          <select
            value={filters.status}
            onChange={(e) => {
              setFilters((f) => ({ ...f, status: e.target.value }));
              resetPaging();
            }}
            className={inputClass}
          >
            <option value="">全部</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
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
            {Object.entries(ORDER_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="支付方式">
          <select
            value={filters.method}
            onChange={(e) => {
              setFilters((f) => ({ ...f, method: e.target.value }));
              resetPaging();
            }}
            className={inputClass}
          >
            <option value="">全部</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
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
        emptyText="没有符合条件的订单"
        onRowClick={(row) => setDetailId(row.id)}
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

      <OrderDetailDrawer
        orderId={detailId}
        onClose={() => setDetailId(null)}
        canAct={isSuperAdmin}
        onMarkPaid={(order) => setMarkPaidTarget(order)}
        onRefund={(order) => {
          setRefundDeduct(true);
          setRefundTarget(order);
        }}
      />

      <ConfirmDialog
        open={markPaidTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMarkPaidTarget(null);
        }}
        title="标记订单已支付"
        description={
          <span className="space-y-2">
            <span className="block">
              订单 {markPaidTarget?.orderNo}，将立即发放{" "}
              {markPaidTarget?.credits} 积分给 {markPaidTarget?.userEmail}。
              请先在支付渠道后台核对到账再操作。
            </span>
            <span className="mt-2 flex items-center gap-2">
              <select
                value={markPaidMethod}
                onChange={(e) => setMarkPaidMethod(e.target.value)}
                className={inputClass}
              >
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={markPaidId}
                onChange={(e) => setMarkPaidId(e.target.value)}
                placeholder="渠道流水号（选填）"
                className={inputClass + " flex-1"}
              />
            </span>
          </span>
        }
        confirmText="确认标记已支付"
        withReason
        reasonRequired
        reasonLabel="操作理由"
        onConfirm={async (reason) => {
          if (!markPaidTarget) return;
          await markPaidMutation.mutateAsync({
            id: markPaidTarget.id,
            note: reason,
          });
          setMarkPaidTarget(null);
        }}
      />

      <ConfirmDialog
        open={refundTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRefundTarget(null);
        }}
        title="订单退款"
        confirmVariant="destructive"
        description={
          <span className="space-y-2">
            <span className="block">
              订单 {refundTarget?.orderNo}（¥{refundTarget?.amount}）将标记为已
              退款。本操作 <strong>不会</strong> 向支付渠道发起退款，请先在渠道
              后台退款后再执行。
            </span>
            <span className="mt-2 flex items-center gap-2 text-sm">
              <input
                id="refund-deduct"
                type="checkbox"
                checked={refundDeduct}
                onChange={(e) => setRefundDeduct(e.target.checked)}
                className="size-4"
              />
              <label htmlFor="refund-deduct">
                同时扣回 {refundTarget?.credits} 积分（余额不足时只扣现有部分）
              </label>
            </span>
          </span>
        }
        confirmText="确认退款"
        withReason
        reasonRequired
        reasonLabel="退款理由"
        onConfirm={async (reason) => {
          if (!refundTarget) return;
          await refundMutation.mutateAsync({ id: refundTarget.id, reason });
          setRefundTarget(null);
        }}
      />
    </div>
  );
}

/** 输入控件统一样式（与系统设置页保持一致） */
const inputClass =
  "border-border bg-input text-foreground focus:border-primary focus:ring-primary/40 rounded-lg border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-50";

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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border rounded-lg border px-4 py-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** 状态着色：已支付绿、退款/取消灰红、待支付黄 */
function statusClass(status: AdminOrder["status"]): string {
  switch (status) {
    case "PAID":
      return "text-green-600";
    case "REFUNDED":
      return "text-destructive";
    case "PENDING":
      return "text-amber-600";
    default:
      return "text-muted-foreground";
  }
}
