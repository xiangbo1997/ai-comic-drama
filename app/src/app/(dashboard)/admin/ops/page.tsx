/**
 * 运维（占位）
 *
 * 本页由后台模块代理接手实现；此处只放页头，保证导航可点、路由已就位。
 */

import { AdminPageHeader } from "../components/AdminPageHeader";

export default function AdminOpsPage() {
  return (
    <div>
      <AdminPageHeader
        title="运维"
        description="数据清理、僵尸任务回收等运维动作。"
      />
      <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        模块建设中
      </p>
    </div>
  );
}
