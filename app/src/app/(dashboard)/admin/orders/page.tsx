/**
 * 订单管理（占位）
 *
 * 本页由后台模块代理接手实现；此处只放页头，保证导航可点、路由已就位。
 */

import { AdminPageHeader } from "../components/AdminPageHeader";

export default function AdminOrdersPage() {
  return (
    <div>
      <AdminPageHeader
        title="订单管理"
        description="订单列表、支付状态核对、手工标记与退款。"
      />
      <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        模块建设中
      </p>
    </div>
  );
}
