/**
 * 用户角色 / 状态 / 积分的统一展示件
 *
 * 列表页与详情页都要渲染这三样。抽出来是因为「什么颜色代表已封禁」这类视觉
 * 约定一旦两处各写一遍，改一处忘一处就会让管理员误判账号状态。
 */

import type { UserRole, UserStatus } from "@prisma/client";

import { cn } from "@/lib/utils";

import { ROLE_LABELS, STATUS_LABELS } from "./types";

/** 角色徽标：超管最显眼，普通用户最弱化 */
const ROLE_STYLE: Record<UserRole, string> = {
  USER: "bg-secondary text-muted-foreground",
  ADMIN: "bg-primary/15 text-primary",
  SUPER_ADMIN: "bg-destructive/15 text-destructive",
};

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        ROLE_STYLE[role]
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

const STATUS_STYLE: Record<UserStatus, string> = {
  ACTIVE: "bg-secondary text-muted-foreground",
  BANNED: "bg-destructive/15 text-destructive",
};

export function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        STATUS_STYLE[status]
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * 积分数值：0 用弱色（无需关注），负数理论上不该出现但仍以警示色显示，
 * 便于一眼看出数据异常而不是被静默展示成普通数字。
 */
export function CreditsValue({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value < 0
          ? "text-destructive"
          : value === 0
            ? "text-muted-foreground"
            : "text-primary"
      )}
    >
      {value.toLocaleString("zh-CN")}
    </span>
  );
}
