/**
 * 后台页面头部：标题 + 说明 + 右侧操作区
 *
 * 各后台模块页统一用它，保证标题层级、间距与操作按钮位置一致。
 */

import type { ReactNode } from "react";

export interface AdminPageHeaderProps {
  title: string;
  description?: string;
  /** 右侧操作区（新建按钮、筛选器等） */
  actions?: ReactNode;
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: AdminPageHeaderProps) {
  return (
    <div className="border-border mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-4">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
