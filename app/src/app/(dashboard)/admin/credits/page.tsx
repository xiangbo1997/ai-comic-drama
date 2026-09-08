/**
 * 积分流水（占位）
 *
 * 本页由后台模块代理接手实现；此处只放页头，保证导航可点、路由已就位。
 */

import { AdminPageHeader } from "../components/AdminPageHeader";

export default function AdminCreditsPage() {
  return (
    <div>
      <AdminPageHeader
        title="积分流水"
        description="全站积分变动流水，支持按用户与类型筛选。"
      />
      <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        模块建设中
      </p>
    </div>
  );
}
