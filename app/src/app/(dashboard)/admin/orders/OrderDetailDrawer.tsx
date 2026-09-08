"use client";

/**
 * 订单详情弹窗
 *
 * 展示订单本体 + 用户 + 关联积分流水 + 审计日志，并挂载「标记已支付」与
 * 「退款」两个入口（真正的确认框由父页统一管理，这里只回调）。
 *
 * 用 Dialog 而非 Sheet：项目里没有 Sheet 原语，为一个抽屉引入新依赖不划算。
 */

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminFetch } from "@/lib/admin-client";

import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  formatDateTime,
  type AdminOrder,
  type OrderDetailResponse,
} from "./types";

export interface OrderDetailDrawerProps {
  /** 打开的订单 id；null 表示关闭 */
  orderId: string | null;
  onClose: () => void;
  /** 是否有权执行标记/退款（超级管理员） */
  canAct: boolean;
  onMarkPaid: (order: AdminOrder) => void;
  onRefund: (order: AdminOrder) => void;
}

export function OrderDetailDrawer({
  orderId,
  onClose,
  canAct,
  onMarkPaid,
  onRefund,
}: OrderDetailDrawerProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-order-detail", orderId],
    queryFn: () =>
      adminFetch<OrderDetailResponse>(`/api/admin/orders/${orderId}`),
    enabled: orderId !== null,
  });

  const order = data?.order;

  return (
    <Dialog
      open={orderId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>订单详情</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <p className="text-muted-foreground text-sm">加载中...</p>
        )}

        {error && (
          <p className="text-destructive text-sm">
            {error instanceof Error ? error.message : "加载失败"}
          </p>
        )}

        {order && data && (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-sm font-medium">订单信息</h3>
              <dl className="border-border divide-border grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-3 text-sm">
                <Field label="订单号" value={order.orderNo} mono />
                <Field label="状态" value={ORDER_STATUS_LABELS[order.status]} />
                <Field label="商品" value={order.productName} />
                <Field label="类型" value={ORDER_TYPE_LABELS[order.type]} />
                <Field label="金额" value={`¥${order.amount}`} />
                <Field label="积分" value={String(order.credits)} />
                <Field
                  label="支付方式"
                  value={
                    order.paymentMethod
                      ? PAYMENT_METHOD_LABELS[order.paymentMethod]
                      : "—"
                  }
                />
                <Field label="渠道流水号" value={order.paymentId ?? "—"} mono />
                <Field
                  label="创建时间"
                  value={formatDateTime(order.createdAt)}
                />
                <Field label="支付时间" value={formatDateTime(order.paidAt)} />
                {order.expiresAt && (
                  <Field
                    label="订阅到期"
                    value={formatDateTime(order.expiresAt)}
                  />
                )}
              </dl>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">用户</h3>
              <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <div>{data.user.email}</div>
                  <div className="text-muted-foreground text-xs">
                    当前余额 {data.user.credits} 积分 · 注册于{" "}
                    {formatDateTime(data.user.createdAt)}
                  </div>
                </div>
                <Link
                  href={`/admin/users/${data.user.id}`}
                  className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                >
                  查看用户 <ExternalLink className="size-3" />
                </Link>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">
                关联积分流水（{data.creditTransactions.length}）
              </h3>
              {data.creditTransactions.length === 0 ? (
                <p className="text-muted-foreground border-border rounded-lg border border-dashed px-3 py-4 text-center text-xs">
                  该订单没有积分流水
                </p>
              ) : (
                <ul className="border-border divide-border divide-y rounded-lg border text-sm">
                  {data.creditTransactions.map((tx) => (
                    <li
                      key={tx.id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div>
                        <span className="text-xs">{tx.type}</span>
                        {tx.note && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {tx.note}
                          </span>
                        )}
                        <div className="text-muted-foreground text-xs">
                          {formatDateTime(tx.createdAt)}
                        </div>
                      </div>
                      <div className="text-right">
                        <span
                          className={
                            tx.delta >= 0
                              ? "text-green-600 tabular-nums"
                              : "text-destructive tabular-nums"
                          }
                        >
                          {tx.delta > 0 ? `+${tx.delta}` : tx.delta}
                        </span>
                        <div className="text-muted-foreground text-xs tabular-nums">
                          余额 {tx.balanceAfter}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">
                操作记录（{data.auditLogs.length}）
              </h3>
              {data.auditLogs.length === 0 ? (
                <p className="text-muted-foreground border-border rounded-lg border border-dashed px-3 py-4 text-center text-xs">
                  暂无管理员操作
                </p>
              ) : (
                <ul className="border-border divide-border divide-y rounded-lg border text-sm">
                  {data.auditLogs.map((entry) => (
                    <li key={entry.id} className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">
                          {entry.action}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {entry.actor.email}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              {order.status === "PENDING" && (
                <Button
                  size="sm"
                  disabled={!canAct}
                  title={canAct ? undefined : "需要超级管理员权限"}
                  onClick={() => onMarkPaid(order)}
                >
                  标记已支付
                </Button>
              )}
              {order.status === "PAID" && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!canAct}
                  title={canAct ? undefined : "需要超级管理员权限"}
                  onClick={() => onRefund(order)}
                >
                  退款
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : "text-sm"}>
        {value}
      </dd>
    </div>
  );
}
