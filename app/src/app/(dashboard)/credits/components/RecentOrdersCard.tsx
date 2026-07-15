"use client";

import { useQuery } from "@tanstack/react-query";
import { Receipt, Loader2 } from "lucide-react";
import {
  fetchRecentOrders,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from "./constants";

/* 最近订单：列出用户近 10 笔充值/订阅订单（金额/积分/状态/时间）。
   此前订单只在支付弹窗轮询期间可见，支付完/离开后无处查看历史与退款状态。 */

/** 状态 → Badge 语义配色（走文字色阶，与卡内其余文案统一） */
const STATUS_COLOR: Record<string, string> = {
  PAID: "text-green-400",
  REFUNDED: "text-yellow-400",
  PENDING: "text-muted-foreground",
  CANCELLED: "text-muted-foreground",
  EXPIRED: "text-muted-foreground",
};

export function RecentOrdersCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["recent-orders"],
    queryFn: fetchRecentOrders,
  });

  const orders = data?.orders ?? [];

  return (
    <div className="bg-card mb-8 rounded-xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <Receipt size={24} className="text-primary" />
        <h2 className="text-lg font-semibold">最近订单</h2>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={24} className="text-muted-foreground animate-spin" />
        </div>
      ) : isError ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          订单加载失败，请刷新页面重试
        </p>
      ) : orders.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          暂无订单记录
        </p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {orders.map((order) => (
            <div
              key={order.id}
              className="hover:bg-secondary/50 flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate">
                  {order.productName}
                  {order.paymentMethod ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ·{" "}
                      {PAYMENT_METHOD_LABELS[order.paymentMethod] ??
                        order.paymentMethod}
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  {new Date(order.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-foreground font-medium">
                  ¥{order.amount}
                  <span className="text-muted-foreground ml-2 text-xs">
                    +{order.credits} 积分
                  </span>
                </p>
                <p
                  className={`text-xs ${
                    STATUS_COLOR[order.status] ?? "text-muted-foreground"
                  }`}
                >
                  {ORDER_STATUS_LABELS[order.status] ?? order.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
