/**
 * 用户管理页的前端类型
 *
 * 与 `/api/admin/users**` 的响应形状一一对应。日期字段在 JSON 里都是字符串，
 * 这里如实声明为 string，避免页面里对 Date 做无效方法调用。
 */

import type { UserRole, UserStatus } from "@prisma/client";

/** 列表行 */
export interface AdminUserListItem {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  credits: number;
  createdAt: string;
  lastLoginAt: string | null;
  inviteCode: string;
  projectCount: number;
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  nextCursor: string | null;
}

/** 详情主体 */
export interface AdminUserProfile {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  status: UserStatus;
  credits: number;
  bannedAt: string | null;
  banReason: string | null;
  lastLoginAt: string | null;
  inviteCode: string;
  invitedBy: string | null;
  createdAt: string;
}

export interface AdminUserStats {
  projects: number;
  characters: number;
  series: number;
  ordersPaid: number;
  totalPaidAmount: number;
  creditsSpent30d: number;
}

export interface AdminCreditTransaction {
  id: string;
  delta: number;
  balanceAfter: number;
  type: string;
  source: string | null;
  note: string | null;
  createdAt: string;
}

export interface AdminUserOrder {
  id: string;
  orderNo: string;
  type: string;
  productName: string;
  amount: number;
  credits: number;
  status: string;
  paymentMethod: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AdminUserAuditLog {
  id: string;
  action: string;
  before: unknown;
  after: unknown;
  note: string | null;
  ip: string | null;
  createdAt: string;
  actorEmail: string;
}

export interface AdminUserDetailResponse {
  user: AdminUserProfile;
  stats: AdminUserStats;
  recentTransactions: AdminCreditTransaction[];
  recentOrders: AdminUserOrder[];
  recentAuditLogs: AdminUserAuditLog[];
}

/** 角色中文名 */
export const ROLE_LABELS: Record<UserRole, string> = {
  USER: "普通用户",
  ADMIN: "管理员",
  SUPER_ADMIN: "超级管理员",
};

/** 状态中文名 */
export const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "正常",
  BANNED: "已封禁",
};

/** 把 ISO 字符串渲染成本地化短日期；空值给出占位符 */
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
